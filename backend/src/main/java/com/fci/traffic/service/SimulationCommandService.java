package com.fci.traffic.service;

import com.fci.traffic.dto.SimulationControlCommandDto;
import com.fci.traffic.kafka.SimulationControlProducer;
import org.springframework.stereotype.Service;

@Service
public class SimulationCommandService {

  private final SimulationControlProducer producer;

  public SimulationCommandService(SimulationControlProducer producer) {
    this.producer = producer;
  }

  public void setScenario(String scenario) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_SCENARIO");
    cmd.setScenario(scenario);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void setSpeed(Double speedFactor) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_SPEED");
    cmd.setSpeedFactor(speedFactor);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void setTraffic(String scenario, Double period, Double fringe) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_TRAFFIC");
    cmd.setScenario(scenario);
    cmd.setTrafficPeriod(period);
    cmd.setTrafficFringe(fringe);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void setAccidentJunction(String junctionId) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(junctionId);
    cmd.setIncidentType("ACCIDENT");
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void setIncident(String junctionId, String incidentType) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(junctionId);
    cmd.setLaneId(null);
    cmd.setIncidentType(incidentType);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void setIncidentLane(String laneId, String incidentType) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(null);
    cmd.setLaneId(laneId);
    cmd.setIncidentType(incidentType);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void clearAccident() throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("SET_ACCIDENT");
    cmd.setAccidentJunctionId(null);
    cmd.setLaneId(null);
    cmd.setIncidentType(null);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void addIncidentLane(String laneId, String incidentType) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("ADD_INCIDENT");
    cmd.setLaneId(laneId);
    cmd.setIncidentType(incidentType);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void addIncidentJunction(String junctionId, String incidentType) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("ADD_INCIDENT");
    cmd.setAccidentJunctionId(junctionId);
    cmd.setIncidentType(incidentType);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void removeIncidentLane(String laneId) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("REMOVE_INCIDENT");
    cmd.setLaneId(laneId);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void clearIncidents() throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("CLEAR_INCIDENTS");
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void start(String scenario) throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("START");
    cmd.setScenario(scenario);
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }

  public void stop() throws Exception {
    SimulationControlCommandDto cmd = new SimulationControlCommandDto();
    cmd.setAction("STOP");
    cmd.setTs(System.currentTimeMillis());
    producer.send(cmd);
  }
}
