package com.fci.traffic.service;

import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * Keeps the latest algorithm state received from the SUMO adapter.
 * Updated by TrafficIngestionService on every snapshot; queried by AlgorithmController.
 */
@Service
public class AlgorithmStateService {

  /** tlsId → last algorithmState map received in a snapshot */
  private final ConcurrentHashMap<String, Map<String, Object>> stateByTls = new ConcurrentHashMap<>();

  public void updateTlsState(String tlsId, Map<String, Object> algorithmState) {
    if (tlsId != null && algorithmState != null && !algorithmState.isEmpty()) {
      stateByTls.put(tlsId, algorithmState);
    }
  }

  public Map<String, Object> getTlsState(String tlsId) {
    return stateByTls.getOrDefault(tlsId, Collections.emptyMap());
  }

  public Map<String, Object> getFullState() {
    return Collections.unmodifiableMap(stateByTls);
  }
}
