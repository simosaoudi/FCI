# On utilise une image qui contient déjà Maven et Java 21
FROM maven:3.9.6-eclipse-temurin-21-alpine

WORKDIR /app

# On copie le pom.xml et le code source
COPY . .

# On lance directement via maven (pas besoin de ./mvnw)
CMD ["mvn", "spring-boot:run"]