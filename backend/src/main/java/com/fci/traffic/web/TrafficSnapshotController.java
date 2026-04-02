package com.fci.traffic.web;

import com.fci.traffic.service.TrafficIngestionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/traffic")
public class TrafficSnapshotController {

  private static final Logger log = LoggerFactory.getLogger(TrafficSnapshotController.class);

  private final TrafficIngestionService ingestionService;

  public TrafficSnapshotController(TrafficIngestionService ingestionService) {
    this.ingestionService = ingestionService;
  }

  @PostMapping("/snapshot")
  public ResponseEntity<Void> receiveSnapshot(@RequestBody String payload) throws Exception {
    log.debug("POST /api/traffic/snapshot reçu");
    ingestionService.ingestSnapshotPayload(payload);
    return ResponseEntity.ok().build();
  }
}
