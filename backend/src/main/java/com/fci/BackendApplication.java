package com.fci;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@SpringBootApplication
@RestController
@RequestMapping("/api/traffic")
public class BackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(BackendApplication.class, args);
    }

    @PostMapping("/update")
    public String receiveTraffic(@RequestBody Map<String, Integer> data) {
        System.out.println("📥 Données reçues du simulateur : " + data);
        return "OK - Données enregistrées";
    }
}