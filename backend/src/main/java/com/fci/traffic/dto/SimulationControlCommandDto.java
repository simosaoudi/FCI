package com.fci.traffic.dto;

public class SimulationControlCommandDto {
  private String action;
  private String scenario;
  private Double speedFactor;
  private String accidentJunctionId;
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

  public String getAccidentJunctionId() {
    return accidentJunctionId;
  }

  public void setAccidentJunctionId(String accidentJunctionId) {
    this.accidentJunctionId = accidentJunctionId;
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
