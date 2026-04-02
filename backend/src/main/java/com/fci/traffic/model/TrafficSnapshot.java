package com.fci.traffic.model;

import java.util.Map;

public class TrafficSnapshot {
    private long ts;
    private int step;
    private String scenario;
    private String tlsId;
    private int phase;
    private Map<String, Integer> lanes;
    private int totalHalted;
    private Map<String, String> laneSignalStates;

    public TrafficSnapshot() {}

    public long getTs() { return ts; }
    public void setTs(long ts) { this.ts = ts; }

    public int getStep() { return step; }
    public void setStep(int step) { this.step = step; }

    public String getScenario() { return scenario; }
    public void setScenario(String scenario) { this.scenario = scenario; }

    public String getTlsId() { return tlsId; }
    public void setTlsId(String tlsId) { this.tlsId = tlsId; }

    public int getPhase() { return phase; }
    public void setPhase(int phase) { this.phase = phase; }

    public Map<String, Integer> getLanes() { return lanes; }
    public void setLanes(Map<String, Integer> lanes) { this.lanes = lanes; }

    public int getTotalHalted() { return totalHalted; }
    public void setTotalHalted(int totalHalted) { this.totalHalted = totalHalted; }

    public Map<String, String> getLaneSignalStates() { return laneSignalStates; }
    public void setLaneSignalStates(Map<String, String> laneSignalStates) { this.laneSignalStates = laneSignalStates; }
}
