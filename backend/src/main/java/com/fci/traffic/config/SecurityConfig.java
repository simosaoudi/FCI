package com.fci.traffic.config;

import java.util.Collection;
import java.util.Collections;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

  @Bean
  public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    http
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        .csrf(csrf -> csrf.disable())
        .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
            // WebSocket handshake: keep open for now (can be secured later)
            .requestMatchers("/ws/**").permitAll()
            // allow basic public landing if any static endpoints exist
            .requestMatchers("/error").permitAll()

            // Read-only endpoints (viewer/operateur/admin)
            .requestMatchers(HttpMethod.GET, "/api/**").hasAnyRole("ADMIN", "OPERATEUR", "VIEWER")

            // Incidents management (operateur/admin)
            .requestMatchers("/api/simulation/incidents/**").hasAnyRole("ADMIN", "OPERATEUR")

            // Start/stop allowed for operateur/admin
            .requestMatchers("/api/simulation/start", "/api/simulation/stop").hasAnyRole("ADMIN", "OPERATEUR")

            // Everything else under simulation is admin-only (scenario, speed, traffic, etc.)
            .requestMatchers("/api/simulation/**").hasRole("ADMIN")

            .anyRequest().authenticated())
        .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())));

    return http.build();
  }

  @Bean
  public CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOrigins(Collections.singletonList("http://localhost:8080"));
    config.setAllowedMethods(java.util.List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
    config.setAllowedHeaders(java.util.List.of("Authorization", "Content-Type"));
    config.setExposedHeaders(java.util.List.of("WWW-Authenticate"));
    config.setAllowCredentials(false);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    return source;
  }

  @Bean
  public JwtAuthenticationConverter jwtAuthenticationConverter() {
    JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
    converter.setJwtGrantedAuthoritiesConverter(this::extractRealmRoles);
    return converter;
  }

  private Collection<GrantedAuthority> extractRealmRoles(Jwt jwt) {
    Object realmAccessObj = jwt.getClaim("realm_access");
    if (!(realmAccessObj instanceof Map<?, ?> realmAccess)) {
      return Collections.emptyList();
    }
    Object rolesObj = realmAccess.get("roles");
    if (!(rolesObj instanceof Collection<?> roles)) {
      return Collections.emptyList();
    }

    return roles.stream()
        .filter(r -> r instanceof String)
        .map(r -> ((String) r).toUpperCase())
        .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
        .collect(Collectors.toSet());
  }
}
