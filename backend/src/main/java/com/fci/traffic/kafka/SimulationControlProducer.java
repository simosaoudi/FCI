package com.fci.traffic.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fci.traffic.dto.SimulationControlCommandDto;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class SimulationControlProducer {

  private final KafkaTemplate<String, String> kafkaTemplate;
  private final KafkaTopicsProperties topics;
  private final ObjectMapper objectMapper;

  public SimulationControlProducer(
      KafkaTemplate<String, String> kafkaTemplate, KafkaTopicsProperties topics, ObjectMapper objectMapper) {
    this.kafkaTemplate = kafkaTemplate;
    this.topics = topics;
    this.objectMapper = objectMapper;
  }

  public void send(SimulationControlCommandDto command) throws Exception {
    String json = objectMapper.writeValueAsString(command);
    kafkaTemplate.send(topics.getSimulationControl(), json);
  }
}
