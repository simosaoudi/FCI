package com.fci.traffic.domain;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TrafficSnapshotRepository extends JpaRepository<TrafficSnapshotEntity, Long> {
}
