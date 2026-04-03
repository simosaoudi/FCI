package com.fci.traffic.web;

import com.fci.traffic.service.AlgorithmStateService;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Expose l'état de l'algorithme dynamique des feux.
 *
 * GET /api/algorithm/state          → état de tous les carrefours
 * GET /api/algorithm/state/{tlsId}  → état d'un carrefour précis
 */
@RestController
@RequestMapping("/api/algorithm")
public class AlgorithmController {

  private final AlgorithmStateService algorithmStateService;

  public AlgorithmController(AlgorithmStateService algorithmStateService) {
    this.algorithmStateService = algorithmStateService;
  }

  @GetMapping("/state")
  public ResponseEntity<Map<String, Object>> getFullState() {
    return ResponseEntity.ok(algorithmStateService.getFullState());
  }

  @GetMapping("/state/{tlsId}")
  public ResponseEntity<Map<String, Object>> getTlsState(@PathVariable String tlsId) {
    Map<String, Object> state = algorithmStateService.getTlsState(tlsId);
    if (state == null || state.isEmpty()) {
      return ResponseEntity.notFound().build();
    }
    return ResponseEntity.ok(state);
  }
}
