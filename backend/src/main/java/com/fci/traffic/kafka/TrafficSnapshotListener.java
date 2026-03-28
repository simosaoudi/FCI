package com.fci.traffic.kafka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fci.traffic.domain.TrafficSnapshotEntity;
import com.fci.traffic.domain.TrafficSnapshotRepository;
import com.fci.traffic.dto.TrafficSnapshotDto;
import java.util.Map;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class TrafficSnapshotListener {

  private final ObjectMapper objectMapper;
  private final TrafficSnapshotRepository repository;
  private final SimpMessagingTemplate messagingTemplate;

  public TrafficSnapshotListener(
      ObjectMapper objectMapper,
      TrafficSnapshotRepository repository,
      SimpMessagingTemplate messagingTemplate) {
    this.objectMapper = objectMapper;
    this.repository = repository;
    this.messagingTemplate = messagingTemplate;
  }

  @KafkaListener(topics = "${app.kafka.topic.trafficSnapshot}")
  public void onMessage(String payload) throws Exception {
    TrafficSnapshotDto dto = objectMapper.readValue(payload, TrafficSnapshotDto.class);

    TrafficSnapshotEntity entity = new TrafficSnapshotEntity();
    entity.setTs(dto.getTs());
    entity.setStep(dto.getStep());
    entity.setScenario(dto.getScenario());
    entity.setTlsId(dto.getTlsId());
    entity.setPhase(dto.getPhase());
    entity.setTotalHalted(dto.getTotalHalted());

    Map<String, Integer> lanes = dto.getLanes();
    String lanesJson = objectMapper.writeValueAsString(
        lanes == null ? Map.of() : objectMapper.convertValue(lanes, new TypeReference<Map<String, Integer>>() {}));
    entity.setLanesJson(lanesJson);

    repository.save(entity);
    messagingTemplate.convertAndSend("/topic/traffic", dto);
  }
}
