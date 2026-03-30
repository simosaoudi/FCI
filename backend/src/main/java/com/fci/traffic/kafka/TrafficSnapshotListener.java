package com.fci.traffic.kafka;

import com.fci.traffic.service.TrafficIngestionService;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class TrafficSnapshotListener {

  private final TrafficIngestionService ingestionService;

  public TrafficSnapshotListener(TrafficIngestionService ingestionService) {
    this.ingestionService = ingestionService;
  }

  @KafkaListener(topics = "${app.kafka.topic.trafficSnapshot}")
  public void onMessage(String payload) throws Exception {
    ingestionService.ingestSnapshotPayload(payload);
  }
}
