package com.fci.traffic.dto;

import java.util.Map;

public class TrafficSnapshotDto {
  private long ts;
  private long step;
  private String scenario;
  private String tlsId;
  private int phase;
  private Map<String, Integer> lanes;
  private int totalHalted;

  public long getTs() {
    return ts;
  }

  public void setTs(long ts) {
    this.ts = ts;
  }

  public long getStep() {
    return step;
  }

  public void setStep(long step) {
    this.step = step;
  }

  public String getScenario() {
    return scenario;
  }

  public void setScenario(String scenario) {
    this.scenario = scenario;
  }

  public String getTlsId() {
    return tlsId;
  }

  public void setTlsId(String tlsId) {
    this.tlsId = tlsId;
  }

  public int getPhase() {
    return phase;
  }

  public void setPhase(int phase) {
    this.phase = phase;
  }

  public Map<String, Integer> getLanes() {
    return lanes;
  }

  public void setLanes(Map<String, Integer> lanes) {
    this.lanes = lanes;
  }

  public int getTotalHalted() {
    return totalHalted;
  }

  public void setTotalHalted(int totalHalted) {
    this.totalHalted = totalHalted;
  }
}
