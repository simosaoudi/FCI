package com.fci.traffic.dto;

public class SimulationControlCommandDto {
  private String action;
  private String scenario;
  private Double speedFactor;
  private Double trafficPeriod;
  private Double trafficFringe;
  private String accidentJunctionId;
  private String laneId;
  private String incidentType;
  private String requestedBy;
  private long ts;

  public String getAction() {
    return action;
  }

  public void setAction(String action) {
    this.action = action;
  }

  public String getScenario() {
    return scenario;
  }

  public void setScenario(String scenario) {
    this.scenario = scenario;
  }

  public Double getSpeedFactor() {
    return speedFactor;
  }

  public void setSpeedFactor(Double speedFactor) {
    this.speedFactor = speedFactor;
  }

  public Double getTrafficPeriod() {
    return trafficPeriod;
  }

  public void setTrafficPeriod(Double trafficPeriod) {
    this.trafficPeriod = trafficPeriod;
  }

  public Double getTrafficFringe() {
    return trafficFringe;
  }

  public void setTrafficFringe(Double trafficFringe) {
    this.trafficFringe = trafficFringe;
  }

  public String getAccidentJunctionId() {
    return accidentJunctionId;
  }

  public void setAccidentJunctionId(String accidentJunctionId) {
    this.accidentJunctionId = accidentJunctionId;
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

  public String getRequestedBy() {
    return requestedBy;
  }

  public void setRequestedBy(String requestedBy) {
    this.requestedBy = requestedBy;
  }

  public long getTs() {
    return ts;
  }

  public void setTs(long ts) {
    this.ts = ts;
  }
}
