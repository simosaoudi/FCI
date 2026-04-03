package com.fci.traffic.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fci.traffic.domain.TrafficSnapshotEntity;
import com.fci.traffic.domain.TrafficSnapshotRepository;
import com.fci.traffic.dto.TrafficSnapshotDto;
import com.fci.traffic.ws.TrafficWsPublisher;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class TrafficIngestionService {

  private static final Logger log = LoggerFactory.getLogger(TrafficIngestionService.class);

  private final ObjectMapper objectMapper;
  private final TrafficSnapshotRepository repository;
  private final TrafficWsPublisher wsPublisher;
  private final AlgorithmStateService algorithmStateService;

  public TrafficIngestionService(
      ObjectMapper objectMapper,
      TrafficSnapshotRepository repository,
      TrafficWsPublisher wsPublisher,
      AlgorithmStateService algorithmStateService) {
    this.objectMapper = objectMapper;
    this.repository = repository;
    this.wsPublisher = wsPublisher;
    this.algorithmStateService = algorithmStateService;
  }

  public void ingestSnapshotPayload(String payload) throws Exception {
    log.debug("Reçu snapshot payload pour ingestion");
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
    log.debug("Snapshot sauvegardé en DB pour TLS: {}", dto.getTlsId());

    algorithmStateService.updateTlsState(dto.getTlsId(), dto.getAlgorithmState());
    wsPublisher.publishTrafficSnapshot(dto);
  }
}
