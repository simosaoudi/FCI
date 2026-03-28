package com.fci.traffic.web;

import com.fci.traffic.dto.SimulationControlCommandDto;
import com.fci.traffic.kafka.SimulationControlProducer;
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

  private final SimulationControlProducer producer;

  public SimulationController(SimulationControlProducer producer) {
    this.producer = producer;
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

  public static class AccidentRequest {
    @NotBlank private String junctionId;

    public String getJunctionId() {
      return junctionId;
    }

    public void setJunctionId(String junctionId) {
      this.junctionId = junctionId;
    }
  }

  @PostMapping("/scenario")
  public ResponseEntity<Void> setScenario(@RequestBody ScenarioRequest request) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_SCENARIO");
    cmd.setScenario(request.getScenario());
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/scenario", params = "scenario")
  public ResponseEntity<Void> setScenarioQuery(@RequestParam("scenario") String scenario) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_SCENARIO");
    cmd.setScenario(scenario);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/speed")
  public ResponseEntity<Void> setSpeed(@RequestBody SpeedRequest request) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_SPEED");
    cmd.setSpeedFactor(request.getSpeedFactor());
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/speed", params = "speedFactor")
  public ResponseEntity<Void> setSpeedQuery(@RequestParam("speedFactor") Double speedFactor) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_SPEED");
    cmd.setSpeedFactor(speedFactor);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
    return ResponseEntity.accepted().build();
  }

  @PostMapping("/accident")
  public ResponseEntity<Void> setAccident(@RequestBody AccidentRequest request) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(request.getJunctionId());
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/accident", params = "junctionId")
  public ResponseEntity<Void> setAccidentQuery(@RequestParam("junctionId") String junctionId) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(junctionId);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
    return ResponseEntity.accepted().build();
  }
}
