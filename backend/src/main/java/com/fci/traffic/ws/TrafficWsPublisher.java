package com.fci.traffic.ws;

import com.fci.traffic.dto.TrafficSnapshotDto;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;

@Component
public class TrafficWsPublisher {

  private final SimpMessagingTemplate messagingTemplate;

  public TrafficWsPublisher(SimpMessagingTemplate messagingTemplate) {
    this.messagingTemplate = messagingTemplate;
  }

  public void publishTrafficSnapshot(@NonNull TrafficSnapshotDto dto) {
    messagingTemplate.convertAndSend("/topic/traffic", dto);
  }
}
