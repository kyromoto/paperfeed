## ADDED Requirements

### Requirement: Redis-Prefix der Queues
Das System SHALL alle BullMQ-Queues unter dem Redis-Prefix aus der optionalen Variablen `SERVER_QUEUE_REDIS_PREFIX` anlegen und SHALL `paperfeed` verwenden, wenn die Variable nicht gesetzt ist.

#### Scenario: Variable nicht gesetzt
- **WHEN** `SERVER_QUEUE_REDIS_PREFIX` nicht gesetzt ist
- **THEN** liegen alle Queue-Schlüssel in Redis unter dem Prefix `paperfeed`

#### Scenario: Variable gesetzt
- **WHEN** `SERVER_QUEUE_REDIS_PREFIX=custom` gesetzt ist
- **THEN** liegen alle Queue-Schlüssel unter dem Prefix `custom`

#### Scenario: Alter Prefix beibehalten
- **WHEN** `SERVER_QUEUE_REDIS_PREFIX=paperless-gdrive-link` gesetzt ist
- **THEN** nutzt die App weiter die Queue-Schlüssel des bisherigen Standard-Prefix

#### Scenario: Leerer Wert
- **WHEN** `SERVER_QUEUE_REDIS_PREFIX` leer gesetzt ist
- **THEN** gilt sie als nicht gesetzt und der Standardwert `paperfeed` wird verwendet
