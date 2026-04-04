"""
dynamic_tls.py — Algorithme dynamique de contrôle des feux de circulation
==========================================================================

Stratégies disponibles :
  - DEMAND_ADAPTIVE  : durées proportionnelles à la demande (voitures + attente)
  - GREEN_WAVE       : coordination inter-carrefours pour permettre une vague verte
  - INCIDENT_PRIORITY: redirige le trafic autour des incidents

Intégration : appelé depuis controle_Traci.py à chaque pas de simulation.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

import traci


# ─── Paramètres de l'algorithme ───────────────────────────────────────────────

class Strategy(str, Enum):
    DEMAND_ADAPTIVE   = "demand_adaptive"
    GREEN_WAVE        = "green_wave"
    INCIDENT_PRIORITY = "incident_priority"


# Durées (en secondes SUMO)
MIN_GREEN      = 12
MAX_GREEN      = 70
YELLOW_DUR     = 3
MIN_CYCLE      = 45
MAX_CYCLE      = 180
CTRL_INTERVAL  = 10          # pas de simulation entre deux décisions

# Poids du score de demande
W_HALT   = 4.0   # véhicules à l'arrêt
W_WAIT   = 0.5   # temps d'attente cumulé (s)
W_OCC    = 20.0  # occupation de voie (0‥1)

# Green Wave
WAVE_SPEED      = 13.9       # vitesse de référence (m/s ≈ 50 km/h)
WAVE_WINDOW     = 10.0       # fenêtre de synchronisation (s)
W_COORD         = 8.0        # bonus de score pour la coordination

# Incidents
INCIDENT_SCORE_FACTOR = 0.0  # une voie avec incident ne reçoit pas de vert


# ─── Structures de données ────────────────────────────────────────────────────

@dataclass
class LaneMetrics:
    lane_id:       str
    vehicle_count: int   = 0
    halt_count:    int   = 0
    wait_time:     float = 0.0   # temps d'attente total sur la voie (s)
    occupancy:     float = 0.0   # occupation 0‥1
    has_incident:  bool  = False
    incident_type: str   = ""


@dataclass
class PhaseInfo:
    phase_idx:       int
    state:           str           # ex. "GGrrGGrr"
    sumo_duration:   float         # durée originale dans SUMO
    is_green:        bool
    controlled_lanes: List[str] = field(default_factory=list)


@dataclass
class TLSDecision:
    tls_id:            str
    green_durations:   Dict[int, float]   # phase_idx → durée verte calculée
    demand_scores:     Dict[int, float]   # phase_idx → score brut
    applied_at_step:   int
    strategy:          str
    cycle_length:      float


# ─── Contrôleur principal ─────────────────────────────────────────────────────

class DynamicTLSController:
    """
    Contrôleur dynamique de feux à trois niveaux :
      1. Adaptif (demande locale en temps réel)
      2. Green Wave (coordination entre carrefours adjacents)
      3. Gestion des incidents (pénalisation des voies bloquées)
    """

    def __init__(
        self,
        tls_ids:          List[str],
        active_incidents: dict,         # référence partagée au dict de controle_Traci.py
        strategy:         Strategy = Strategy.DEMAND_ADAPTIVE,
    ):
        self.tls_ids          = tls_ids
        self.active_incidents = active_incidents
        self.strategy         = strategy

        self._last_decision:     Dict[str, TLSDecision]      = {}
        self._step_counter:      Dict[str, int]               = {t: 0 for t in tls_ids}
        self._tls_positions:     Dict[str, Tuple[float,float]] = {}
        self._neighbors:         Dict[str, List[str]]         = {}
        self._cycle_start_step:  Dict[str, int]               = {}
        self._initialized = False

    # ── Topologie (initialisée au 1er step) ────────────────────────────────────

    def _init_topology(self) -> None:
        """Calcule les positions et voisins de chaque carrefour."""
        for tls_id in self.tls_ids:
            pos = (0.0, 0.0)
            try:
                lanes = list(set(traci.trafficlight.getControlledLanes(tls_id)))
                if lanes:
                    shape = traci.lane.getShape(lanes[0])
                    if shape:
                        pos = (float(shape[-1][0]), float(shape[-1][1]))
            except Exception:
                pass
            self._tls_positions[tls_id] = pos

        # Voisins = carrefours à moins de 500 m
        MAX_DIST = 500.0
        for a_id in self.tls_ids:
            self._neighbors[a_id] = []
            pa = self._tls_positions[a_id]
            for b_id in self.tls_ids:
                if a_id == b_id:
                    continue
                pb = self._tls_positions[b_id]
                if math.hypot(pa[0]-pb[0], pa[1]-pb[1]) <= MAX_DIST:
                    self._neighbors[a_id].append(b_id)

        self._initialized = True

    # ── Collecte des données TraCI ─────────────────────────────────────────────

    def _collect_metrics(self, tls_id: str) -> Dict[str, LaneMetrics]:
        result: Dict[str, LaneMetrics] = {}
        try:
            lanes = list(set(traci.trafficlight.getControlledLanes(tls_id)))
            for lane in lanes:
                m = LaneMetrics(lane_id=lane)
                try:
                    m.vehicle_count = int(traci.lane.getLastStepVehicleNumber(lane))
                    m.halt_count    = int(traci.lane.getLastStepHaltingNumber(lane))
                    m.wait_time     = float(traci.lane.getWaitingTime(lane))
                    m.occupancy     = float(traci.lane.getLastStepOccupancy(lane)) / 100.0
                except Exception:
                    pass
                m.has_incident  = lane in self.active_incidents
                # active_incidents values are plain strings (e.g. "ACCIDENT")
                raw = self.active_incidents.get(lane, "")
                m.incident_type = str(raw.get("type", raw) if isinstance(raw, dict) else raw)
                result[lane] = m
        except Exception:
            pass
        return result

    def _parse_phases(self, tls_id: str) -> List[PhaseInfo]:
        """Lit le programme de feux courant depuis SUMO."""
        phases: List[PhaseInfo] = []
        try:
            logics = traci.trafficlight.getAllProgramLogics(tls_id)
            if not logics:
                return phases
            logic  = logics[0]
            links  = traci.trafficlight.getControlledLinks(tls_id)

            for idx, phase in enumerate(logic.phases):
                state    = phase.state
                is_green = any(c in ('G', 'g') for c in state)

                # Voies entrantes activées dans cette phase
                phase_lanes: List[str] = []
                for sig_idx, ch in enumerate(state):
                    if ch not in ('G', 'g'):
                        continue
                    if sig_idx >= len(links):
                        continue
                    for link in links[sig_idx]:
                        try:
                            fl = str(link[0])
                            if fl not in phase_lanes:
                                phase_lanes.append(fl)
                        except Exception:
                            pass

                phases.append(PhaseInfo(
                    phase_idx=idx,
                    state=state,
                    sumo_duration=float(phase.duration),
                    is_green=is_green,
                    controlled_lanes=phase_lanes,
                ))
        except Exception:
            pass
        return phases

    # ── Score de demande ───────────────────────────────────────────────────────

    def _demand_score(
        self,
        phase:   PhaseInfo,
        metrics: Dict[str, LaneMetrics],
    ) -> float:
        """
        ╔══════════════════════════════════════════════════════════╗
        ║  PSEUDO-CODE — Score de demande d'une phase verte        ║
        ║                                                          ║
        ║  score = 0                                               ║
        ║  Pour chaque voie active dans la phase :                 ║
        ║    f_incident = 0 si incident, sinon 1                   ║
        ║    score += (W_HALT × arrêtés                            ║
        ║              + W_WAIT × temps_attente                    ║
        ║              + W_OCC  × occupation) × f_incident         ║
        ║  return max(0, score)                                    ║
        ╚══════════════════════════════════════════════════════════╝
        """
        score = 0.0
        for lane in phase.controlled_lanes:
            m = metrics.get(lane)
            if m is None:
                continue
            f_incident = INCIDENT_SCORE_FACTOR if m.has_incident else 1.0
            score += (
                W_HALT * m.halt_count
                + W_WAIT * m.wait_time
                + W_OCC  * m.occupancy
            ) * f_incident
        return max(0.0, score)

    # ── Bonus de coordination (Green Wave) ────────────────────────────────────

    def _coord_bonus(self, tls_id: str, current_step: int) -> float:
        """
        ╔══════════════════════════════════════════════════════════╗
        ║  PSEUDO-CODE — Bonus Green Wave                          ║
        ║                                                          ║
        ║  Pour chaque voisin adjacent :                           ║
        ║    distance  = dist(tls, voisin)                         ║
        ║    travel_s  = distance / WAVE_SPEED                     ║
        ║    cycle_age = step_courant - step_début_cycle_voisin    ║
        ║    Si |cycle_age - travel_s| < WAVE_WINDOW :             ║
        ║      bonus += W_COORD   # synchronisation optimale       ║
        ║  return bonus                                            ║
        ╚══════════════════════════════════════════════════════════╝
        """
        if self.strategy not in (Strategy.GREEN_WAVE, Strategy.DEMAND_ADAPTIVE):
            return 0.0

        bonus = 0.0
        pa = self._tls_positions.get(tls_id, (0.0, 0.0))

        for neighbor_id in self._neighbors.get(tls_id, []):
            pb = self._tls_positions.get(neighbor_id, (0.0, 0.0))
            dist = math.hypot(pa[0]-pb[0], pa[1]-pb[1])
            if dist < 1e-3:
                continue

            travel_steps = (dist / WAVE_SPEED)  # steps ≈ secondes dans SUMO
            neighbor_cycle_start = self._cycle_start_step.get(neighbor_id)
            if neighbor_cycle_start is None:
                continue

            elapsed = float(current_step - neighbor_cycle_start)
            if abs(elapsed - travel_steps) <= WAVE_WINDOW:
                bonus += W_COORD

        return bonus

    # ── Calcul des durées optimales ────────────────────────────────────────────

    def _compute_durations(
        self,
        tls_id:       str,
        phases:       List[PhaseInfo],
        metrics:      Dict[str, LaneMetrics],
        current_step: int,
    ) -> Tuple[Dict[int, float], Dict[int, float], float]:
        """
        ╔══════════════════════════════════════════════════════════╗
        ║  PSEUDO-CODE — Allocation des durées vertes              ║
        ║                                                          ║
        ║  n = nombre de phases vertes                             ║
        ║  charge_globale = Σ halt_count(toutes voies)             ║
        ║  cycle = MIN_CYCLE + f(charge_globale)   [clampé]        ║
        ║  vert_disponible = cycle - n × YELLOW_DUR                ║
        ║                                                          ║
        ║  scores[i] = demand_score(phase_i) + coord_bonus(tls)    ║
        ║  total_score = Σ scores                                  ║
        ║                                                          ║
        ║  Pour chaque phase verte i :                             ║
        ║    ratio[i] = scores[i] / total_score                    ║
        ║    vert[i]  = clamp(ratio[i] × vert_disponible,          ║
        ║                     MIN_GREEN, MAX_GREEN)                ║
        ╚══════════════════════════════════════════════════════════╝
        """
        green_phases = [p for p in phases if p.is_green]
        if not green_phases:
            return {}, {}, 0.0

        n = len(green_phases)

        # Durée de cycle adaptative selon la charge globale
        total_halted = sum(m.halt_count for m in metrics.values())
        raw_cycle    = MIN_CYCLE + min(MAX_CYCLE - MIN_CYCLE, total_halted * 2.5)
        cycle        = float(min(MAX_CYCLE, max(MIN_CYCLE, raw_cycle)))
        available    = max(MIN_GREEN * n, cycle - n * YELLOW_DUR)

        # Scores
        scores: Dict[int, float] = {}
        coord_bonus = self._coord_bonus(tls_id, current_step)
        for p in green_phases:
            base  = self._demand_score(p, metrics)
            # Bonus de coordination appliqué uniformément (on ne peut pas savoir
            # quelle phase bénéficiera de la vague sans topologie directionnelle)
            scores[p.phase_idx] = base + coord_bonus

        total_score = sum(scores.values())

        # Allocation
        durations: Dict[int, float] = {}
        raw_scores: Dict[int, float] = {}
        for p in green_phases:
            raw_scores[p.phase_idx] = scores[p.phase_idx]
            if total_score < 1e-3:
                # Aucune demande → répartition égale
                dur = available / n
            else:
                dur = (scores[p.phase_idx] / total_score) * available

            durations[p.phase_idx] = float(max(MIN_GREEN, min(MAX_GREEN, dur)))

        return durations, raw_scores, cycle

    # ── Stratégie INCIDENT_PRIORITY ────────────────────────────────────────────

    def _apply_incident_priority(
        self,
        phases:   List[PhaseInfo],
        metrics:  Dict[str, LaneMetrics],
        durations: Dict[int, float],
    ) -> Dict[int, float]:
        """
        Si la stratégie est INCIDENT_PRIORITY :
        - Les phases dont toutes les voies ont un incident → MIN_GREEN
        - Les phases perpendiculaires (libres) → prolongées
        """
        if self.strategy != Strategy.INCIDENT_PRIORITY:
            return durations

        adjusted = dict(durations)
        total_extra = 0.0

        for p in [ph for ph in phases if ph.is_green]:
            lanes = p.controlled_lanes
            if not lanes:
                continue
            all_blocked = all(
                metrics[l].has_incident for l in lanes if l in metrics
            )
            if all_blocked:
                gained = adjusted.get(p.phase_idx, MIN_GREEN) - MIN_GREEN
                adjusted[p.phase_idx] = float(MIN_GREEN)
                total_extra += max(0.0, gained)

        # Redistribuer le temps gagné aux phases libres
        free_phases = [
            p for p in phases
            if p.is_green and not all(
                metrics.get(l, LaneMetrics(l)).has_incident for l in p.controlled_lanes
            )
        ]
        if free_phases and total_extra > 0:
            bonus = total_extra / len(free_phases)
            for p in free_phases:
                adjusted[p.phase_idx] = float(
                    min(MAX_GREEN, adjusted.get(p.phase_idx, MIN_GREEN) + bonus)
                )

        return adjusted

    # ── Application à SUMO ────────────────────────────────────────────────────

    def _apply_to_sumo(
        self,
        tls_id:   str,
        phases:   List[PhaseInfo],
        durations: Dict[int, float],
    ) -> None:
        """
        Applique les nouvelles durées via setProgramLogic (reconfigure le programme
        entier) ; si non disponible, fallback sur setPhaseDuration (phase courante).
        """
        try:
            logics = traci.trafficlight.getAllProgramLogic(tls_id)
        except AttributeError:
            logics = traci.trafficlight.getAllProgramLogics(tls_id)
        except Exception:
            logics = []

        if not logics:
            self._fallback_set_duration(tls_id, phases, durations)
            return

        current_logic = logics[0]
        new_phases = []
        for p in phases:
            new_dur = durations.get(p.phase_idx, p.sumo_duration) if p.is_green else p.sumo_duration
            try:
                new_phases.append(
                    traci.trafficlight.Phase(
                        duration=float(new_dur),
                        state=p.state,
                        minDur=float(MIN_GREEN) if p.is_green else float(p.sumo_duration),
                        maxDur=float(MAX_GREEN) if p.is_green else float(p.sumo_duration),
                    )
                )
            except TypeError:
                # SUMO plus ancien : pas de minDur/maxDur
                new_phases.append(
                    traci.trafficlight.Phase(float(new_dur), p.state)
                )

        try:
            new_logic = traci.trafficlight.Logic(
                programID=current_logic.programID,
                type=current_logic.type,
                currentPhaseIndex=traci.trafficlight.getPhase(tls_id),
                phases=new_phases,
                subParameter=current_logic.subParameter,
            )
            traci.trafficlight.setProgramLogic(tls_id, new_logic)
        except Exception:
            self._fallback_set_duration(tls_id, phases, durations)

    def _fallback_set_duration(
        self,
        tls_id:   str,
        phases:   List[PhaseInfo],
        durations: Dict[int, float],
    ) -> None:
        """Fallback : modifie uniquement la durée restante de la phase courante."""
        try:
            current = traci.trafficlight.getPhase(tls_id)
            if current in durations:
                traci.trafficlight.setPhaseDuration(tls_id, float(durations[current]))
        except Exception:
            pass

    # ── Point d'entrée principal ───────────────────────────────────────────────

    def step(self, simulation_step: int) -> Dict[str, TLSDecision]:
        """
        Appelé à chaque pas de simulation depuis controle_Traci.py.
        Retourne les décisions prises (incluses dans les snapshots envoyés au backend).
        """
        if not self._initialized:
            try:
                self._init_topology()
            except Exception:
                return {}

        decisions: Dict[str, TLSDecision] = {}

        for tls_id in self.tls_ids:
            # Cadence de décision
            self._step_counter[tls_id] = self._step_counter.get(tls_id, 0) + 1
            if self._step_counter[tls_id] < CTRL_INTERVAL:
                continue
            self._step_counter[tls_id] = 0

            try:
                metrics  = self._collect_metrics(tls_id)
                phases   = self._parse_phases(tls_id)

                if not any(p.is_green for p in phases):
                    continue

                # Enregistrer le début de cycle (phase 0) pour la green wave
                try:
                    current_phase = traci.trafficlight.getPhase(tls_id)
                    if current_phase == 0:
                        self._cycle_start_step[tls_id] = simulation_step
                except Exception:
                    pass

                # Calcul des durées optimales
                durations, scores, cycle = self._compute_durations(
                    tls_id, phases, metrics, simulation_step
                )

                # Ajustement selon la stratégie
                durations = self._apply_incident_priority(phases, metrics, durations)

                # Application à SUMO
                self._apply_to_sumo(tls_id, phases, durations)

                dec = TLSDecision(
                    tls_id=tls_id,
                    green_durations=durations,
                    demand_scores=scores,
                    applied_at_step=simulation_step,
                    strategy=self.strategy.value,
                    cycle_length=cycle,
                )
                self._last_decision[tls_id] = dec
                decisions[tls_id] = dec

            except Exception:
                # L'algorithme ne doit jamais crasher la simulation
                pass

        return decisions

    # ── Changement de stratégie à chaud ───────────────────────────────────────

    def set_strategy(self, strategy_name: str) -> bool:
        """Permet de changer de stratégie depuis une commande HTTP."""
        try:
            self.strategy = Strategy(strategy_name)
            return True
        except ValueError:
            return False

    # ── Export de l'état pour les snapshots ───────────────────────────────────

    def get_tls_algorithm_state(self, tls_id: str) -> dict:
        """
        Retourne l'état algorithmique d'un carrefour précis.
        Inclus dans les snapshots envoyés à Spring Boot.
        """
        dec = self._last_decision.get(tls_id)
        if dec is None:
            return {}
        return {
            "strategy":       dec.strategy,
            "cycleLength":    dec.cycle_length,
            "greenDurations": {str(k): round(v, 1) for k, v in dec.green_durations.items()},
            "demandScores":   {str(k): round(v, 2) for k, v in dec.demand_scores.items()},
            "appliedAtStep":  dec.applied_at_step,
        }

    def get_full_state(self) -> dict:
        """État complet de tous les carrefours (pour l'endpoint REST /api/algorithm/state)."""
        return {
            "strategy": self.strategy.value,
            "intersections": {
                tls_id: self.get_tls_algorithm_state(tls_id)
                for tls_id in self.tls_ids
            },
        }
