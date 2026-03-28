package com.fci.traffic.kafka;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.kafka.topic")
public class KafkaTopicsProperties {
  private String trafficSnapshot;
  private String simulationControl;

  public String getTrafficSnapshot() {
    return trafficSnapshot;
  }

  public void setTrafficSnapshot(String trafficSnapshot) {
    this.trafficSnapshot = trafficSnapshot;
  }

  public String getSimulationControl() {
    return simulationControl;
  }

  public void setSimulationControl(String simulationControl) {
    this.simulationControl = simulationControl;
  }
}
