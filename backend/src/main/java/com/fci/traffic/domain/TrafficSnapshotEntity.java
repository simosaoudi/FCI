package com.fci.traffic.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

@Entity
@Table(
    name = "traffic_snapshot",
    indexes = {
      @Index(name = "idx_snapshot_tls_ts", columnList = "tlsId,ts"),
      @Index(name = "idx_snapshot_ts", columnList = "ts")
    })
public class TrafficSnapshotEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false)
  private long ts;

  @Column(nullable = false)
  private long step;

  @Column(nullable = false)
  private String scenario;

  @Column(nullable = false)
  private String tlsId;

  @Column(nullable = false)
  private int phase;

  @Column(nullable = false)
  private int totalHalted;

  @Column(columnDefinition = "text", nullable = false)
  private String lanesJson;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
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

  public int getTotalHalted() {
    return totalHalted;
  }

  public void setTotalHalted(int totalHalted) {
    this.totalHalted = totalHalted;
  }

  public String getLanesJson() {
    return lanesJson;
  }

  public void setLanesJson(String lanesJson) {
    this.lanesJson = lanesJson;
  }
}
