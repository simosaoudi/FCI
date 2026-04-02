package com.fci.traffic.ws;

import com.fci.traffic.dto.TrafficSnapshotDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.lang.NonNull;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class TrafficWsPublisher {

  private static final Logger log = LoggerFactory.getLogger(TrafficWsPublisher.class);

  private final SimpMessagingTemplate messagingTemplate;

  public TrafficWsPublisher(SimpMessagingTemplate messagingTemplate) {
    this.messagingTemplate = messagingTemplate;
  }

  public void publishTrafficSnapshot(@NonNull TrafficSnapshotDto snapshot) {
    log.debug("Envoi WebSocket pour TLS: {}", snapshot.getTlsId());
    messagingTemplate.convertAndSend("/topic/traffic", snapshot);
  }
}
