package com.fci.traffic.service;

import com.fci.traffic.dto.SimulationControlCommandDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class SimulationCommandService {

  private final RestTemplate restTemplate;
  private final ObjectMapper objectMapper;

  public SimulationCommandService(RestTemplate restTemplate, ObjectMapper objectMapper) {
    this.restTemplate = restTemplate;
    this.objectMapper = objectMapper;
  }

  public void setScenario(String scenario) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_SCENARIO");
    cmd.setScenario(scenario);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void setSpeed(Double speedFactor) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_SPEED");
    cmd.setSpeedFactor(speedFactor);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  private void sendCommand(SimulationControlCommandDto cmd) throws Exception {
    String json = objectMapper.writeValueAsString(cmd);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    HttpEntity<String> entity = new HttpEntity<>(json, headers);
    restTemplate.postForEntity("http://sumo-adapter:8766/command", entity, String.class);
  }

  public void setTraffic(String scenario, Double period, Double fringe) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_TRAFFIC");
    cmd.setScenario(scenario);
    cmd.setTrafficPeriod(period);
    cmd.setTrafficFringe(fringe);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void setAccidentJunction(String junctionId) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(junctionId);
    cmd.setIncidentType("ACCIDENT");
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void setIncident(String junctionId, String incidentType) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(junctionId);
    cmd.setLaneId(null);
    cmd.setIncidentType(incidentType);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void setIncidentLane(String laneId, String incidentType) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(null);
    cmd.setLaneId(laneId);
    cmd.setIncidentType(incidentType);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void clearAccident() throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(null);
    cmd.setLaneId(null);
    cmd.setIncidentType(null);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void addIncidentLane(String laneId, String incidentType) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("ADD_INCIDENT");
    cmd.setLaneId(laneId);
    cmd.setIncidentType(incidentType);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void addIncidentJunction(String junctionId, String incidentType) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("ADD_INCIDENT");
    cmd.setAccidentJunctionId(junctionId);
    cmd.setIncidentType(incidentType);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void removeIncidentLane(String laneId) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("REMOVE_INCIDENT");
    cmd.setLaneId(laneId);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void clearIncidents() throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("CLEAR_INCIDENTS");
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void start(String scenario) throws Exception {
    start(scenario, null, null);
  }

  public void start(String scenario, String tlsMode, String trafficLevel) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("START");
    cmd.setScenario(scenario);
    cmd.setTlsMode(tlsMode);
    cmd.setTrafficLevel(trafficLevel);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void configure(String scenario, String tlsMode, String trafficLevel) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("CONFIGURE");
    cmd.setScenario(scenario != null ? scenario : "normal");
    cmd.setTlsMode(tlsMode);
    cmd.setTrafficLevel(trafficLevel);
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }

  public void stop() throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("STOP");
    cmd.setTs(System.currentTimeMillis());
    sendCommand(cmd);
  }
}
