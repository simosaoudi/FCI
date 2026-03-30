package com.fci.traffic.web;

import com.fci.traffic.service.SimulationCommandService;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;

@RestController
@RequestMapping("/api/simulation")
@Validated
public class SimulationController {

  private final SimulationCommandService commandService;

  public SimulationController(SimulationCommandService commandService) {
    this.commandService = commandService;
  }

  public static class IncidentAddRequest {
    private String junctionId;
    private String laneId;
    private String incidentType;

    public String getJunctionId() {
      return junctionId;
    }

    public void setJunctionId(String junctionId) {
      this.junctionId = junctionId;
    }

    public String getLaneId() {
      return laneId;
    }

    public void setLaneId(String laneId) {
      this.laneId = laneId;
    }

    public String getIncidentType() {
      return incidentType;
    }

    public void setIncidentType(String incidentType) {
      this.incidentType = incidentType;
    }
  }

  public static class IncidentRemoveRequest {
    @NotBlank private String laneId;

    public String getLaneId() {
      return laneId;
    }

    public void setLaneId(String laneId) {
      this.laneId = laneId;
    }
  }

  public static class ScenarioRequest {
    @NotBlank private String scenario;

    public String getScenario() {
      return scenario;
    }

    public void setScenario(String scenario) {
      this.scenario = scenario;
    }
  }

  public static class SpeedRequest {
    @NotNull private Double speedFactor;

    public Double getSpeedFactor() {
      return speedFactor;
    }

    public void setSpeedFactor(Double speedFactor) {
      this.speedFactor = speedFactor;
    }
  }

  public static class TrafficRequest {
    @NotBlank private String scenario;
    @NotNull private Double period;
    @NotNull private Double fringe;

    public String getScenario() {
      return scenario;
    }

    public void setScenario(String scenario) {
      this.scenario = scenario;
    }

    public Double getPeriod() {
      return period;
    }

    public void setPeriod(Double period) {
      this.period = period;
    }

    public Double getFringe() {
      return fringe;
    }

    public void setFringe(Double fringe) {
      this.fringe = fringe;
    }
  }

  public static class AccidentRequest {
    private String junctionId;
    private String laneId;
    private String incidentType;

    public String getJunctionId() {
      return junctionId;
    }

    public void setJunctionId(String junctionId) {
      this.junctionId = junctionId;
    }

    public String getLaneId() {
      return laneId;
    }

    public void setLaneId(String laneId) {
      this.laneId = laneId;
    }

    public String getIncidentType() {
      return incidentType;
    }

    public void setIncidentType(String incidentType) {
      this.incidentType = incidentType;
    }
  }

  @PostMapping("/start")
  public ResponseEntity<Void> start(@RequestBody ScenarioRequest request) throws Exception {
    commandService.start(request.getScenario());
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/start", params = "scenario")
  public ResponseEntity<Void> startQuery(@RequestParam("scenario") String scenario) throws Exception {
    commandService.start(scenario);
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/stop")
  public ResponseEntity<Void> stop() throws Exception {
    commandService.stop();
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/scenario")
  public ResponseEntity<Void> setScenario(@RequestBody ScenarioRequest request) throws Exception {
    commandService.setScenario(request.getScenario());
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/scenario", params = "scenario")
  public ResponseEntity<Void> setScenarioQuery(@RequestParam("scenario") String scenario) throws Exception {
    commandService.setScenario(scenario);
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/speed")
  public ResponseEntity<Void> setSpeed(@RequestBody SpeedRequest request) throws Exception {
    commandService.setSpeed(request.getSpeedFactor());
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/speed", params = "speedFactor")
  public ResponseEntity<Void> setSpeedQuery(@RequestParam("speedFactor") Double speedFactor) throws Exception {
    commandService.setSpeed(speedFactor);
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/traffic")
  public ResponseEntity<Void> setTraffic(@RequestBody TrafficRequest request) throws Exception {
    commandService.setTraffic(request.getScenario(), request.getPeriod(), request.getFringe());
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/accident")
  public ResponseEntity<Void> setAccident(@RequestBody AccidentRequest request) throws Exception {
    String t = request.getIncidentType();
    String type = t == null || t.isBlank() ? "ACCIDENT" : t;
    String laneId = request.getLaneId();
    String junctionId = request.getJunctionId();
    if (laneId != null && !laneId.isBlank()) {
      commandService.setIncidentLane(laneId, type);
    } else if (junctionId != null && !junctionId.isBlank()) {
      commandService.setIncident(junctionId, type);
    } else {
      commandService.clearAccident();
    }
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/accident", params = "junctionId")
  public ResponseEntity<Void> setAccidentQuery(
      @RequestParam("junctionId") String junctionId,
      @RequestParam(value = "incidentType", required = false) String incidentType)
      throws Exception {
    String t = incidentType == null || incidentType.isBlank() ? "ACCIDENT" : incidentType;
    commandService.setIncident(junctionId, t);
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/accident", params = "laneId")
  public ResponseEntity<Void> setAccidentLaneQuery(
      @RequestParam("laneId") String laneId,
      @RequestParam(value = "incidentType", required = false) String incidentType)
      throws Exception {
    String t = incidentType == null || incidentType.isBlank() ? "ACCIDENT" : incidentType;
    commandService.setIncidentLane(laneId, t);
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/accident/clear")
  public ResponseEntity<Void> clearAccident() throws Exception {
    commandService.clearAccident();
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/incidents/add")
  public ResponseEntity<Void> addIncident(@RequestBody IncidentAddRequest request) throws Exception {
    String t = request.getIncidentType();
    String type = t == null || t.isBlank() ? "ACCIDENT" : t;
    String laneId = request.getLaneId();
    String junctionId = request.getJunctionId();
    if (laneId != null && !laneId.isBlank()) {
      commandService.addIncidentLane(laneId, type);
    } else if (junctionId != null && !junctionId.isBlank()) {
      commandService.addIncidentJunction(junctionId, type);
    }
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/incidents/remove")
  public ResponseEntity<Void> removeIncident(@RequestBody IncidentRemoveRequest request) throws Exception {
    commandService.removeIncidentLane(request.getLaneId());
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/incidents/clear")
  public ResponseEntity<Void> clearIncidents() throws Exception {
    commandService.clearIncidents();
    return ResponseEntity.accepted().build();
  }
}
