package com.fci.traffic.dto;

import java.util.List;
import java.util.Map;

public class TrafficSnapshotDto {
  private long ts;
  private long step;
  private String scenario;
  private String tlsId;
  private int phase;
  private String tlState;
  private List<String> controlledLanes;
  private Map<String, String> laneSignalStates;
  private Map<String, Integer> lanes;
  private int totalHalted;
  private List<VehicleSnapshotDto> vehicles;

  public static class VehicleSnapshotDto {
    private String id;
    private double x;
    private double y;
    private Double speed;
    private Double angle;

    public String getId() {
      return id;
    }

    public void setId(String id) {
      this.id = id;
    }

    public double getX() {
      return x;
    }

    public void setX(double x) {
      this.x = x;
    }

    public double getY() {
      return y;
    }

    public void setY(double y) {
      this.y = y;
    }

    public Double getSpeed() {
      return speed;
    }

    public void setSpeed(Double speed) {
      this.speed = speed;
    }

    public Double getAngle() {
      return angle;
    }

    public void setAngle(Double angle) {
      this.angle = angle;
    }
  }

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

  public String getTlState() {
    return tlState;
  }

  public void setTlState(String tlState) {
    this.tlState = tlState;
  }

  public List<String> getControlledLanes() {
    return controlledLanes;
  }

  public void setControlledLanes(List<String> controlledLanes) {
    this.controlledLanes = controlledLanes;
  }

  public Map<String, String> getLaneSignalStates() {
    return laneSignalStates;
  }

  public void setLaneSignalStates(Map<String, String> laneSignalStates) {
    this.laneSignalStates = laneSignalStates;
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

  public List<VehicleSnapshotDto> getVehicles() {
    return vehicles;
  }

  public void setVehicles(List<VehicleSnapshotDto> vehicles) {
    this.vehicles = vehicles;
  }
}
