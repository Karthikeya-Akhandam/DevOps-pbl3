-- Run in MySQL Workbench connected to MySQL Server 8.0 or later before starting the API in MySQL mode.
CREATE DATABASE IF NOT EXISTS vehicle_rental
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE vehicle_rental;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('CUSTOMER', 'ADMIN') NOT NULL DEFAULT 'CUSTOMER',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cities (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_types (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(40) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rental_locations (
  id CHAR(36) PRIMARY KEY,
  city_id VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  type VARCHAR(40) NOT NULL,
  address_description VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_locations_city FOREIGN KEY (city_id) REFERENCES cities(id),
  UNIQUE KEY uq_location_city_name (city_id, name),
  KEY idx_locations_city_active (city_id, active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehicles (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  brand VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  type_id CHAR(36) NOT NULL,
  category VARCHAR(40) NOT NULL,
  subcategory VARCHAR(60) NOT NULL,
  city_id VARCHAR(64) NOT NULL,
  location_id CHAR(36) NOT NULL,
  fuel_type VARCHAR(30) NOT NULL,
  transmission VARCHAR(30) NOT NULL,
  seating_capacity TINYINT UNSIGNED NOT NULL,
  description TEXT NOT NULL,
  specifications JSON NOT NULL,
  features JSON NOT NULL,
  image_url TEXT NOT NULL,
  fallback_image_url TEXT NOT NULL,
  base_daily_rate DECIMAL(12,2) NOT NULL,
  base_hourly_rate DECIMAL(12,2) NOT NULL,
  min_daily_rate DECIMAL(12,2) NOT NULL,
  max_daily_rate DECIMAL(12,2) NOT NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'MAINTENANCE') NOT NULL DEFAULT 'ACTIVE',
  maintenance_status VARCHAR(30) NOT NULL DEFAULT 'OK',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_vehicles_type FOREIGN KEY (type_id) REFERENCES vehicle_types(id),
  CONSTRAINT fk_vehicles_city FOREIGN KEY (city_id) REFERENCES cities(id),
  CONSTRAINT fk_vehicles_location FOREIGN KEY (location_id) REFERENCES rental_locations(id),
  CONSTRAINT chk_vehicle_rates CHECK (
    base_daily_rate >= 0 AND base_hourly_rate >= 0 AND
    min_daily_rate >= 0 AND max_daily_rate >= min_daily_rate
  ),
  KEY idx_vehicles_search (city_id, type_id, status, base_daily_rate),
  KEY idx_vehicles_location_status (location_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pricing_settings (
  id TINYINT UNSIGNED PRIMARY KEY,
  rule_version VARCHAR(80) NOT NULL DEFAULT 'mysql-v1',
  duration_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 10,
  early_booking_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  early_booking_minimum_days SMALLINT UNSIGNED NOT NULL DEFAULT 14,
  booking_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  demand_low_score DECIMAL(8,2) NOT NULL DEFAULT 50,
  demand_normal_score DECIMAL(8,2) NOT NULL DEFAULT 100,
  demand_elevated_score DECIMAL(8,2) NOT NULL DEFAULT 150,
  low_demand_multiplier DECIMAL(5,3) NOT NULL DEFAULT 0.900,
  normal_demand_multiplier DECIMAL(5,3) NOT NULL DEFAULT 1.000,
  elevated_demand_multiplier DECIMAL(5,3) NOT NULL DEFAULT 1.100,
  high_demand_multiplier DECIMAL(5,3) NOT NULL DEFAULT 1.200,
  availability_low_ratio DECIMAL(5,4) NOT NULL DEFAULT 0.2000,
  availability_medium_ratio DECIMAL(5,4) NOT NULL DEFAULT 0.5000,
  low_availability_multiplier DECIMAL(5,3) NOT NULL DEFAULT 1.150,
  medium_availability_multiplier DECIMAL(5,3) NOT NULL DEFAULT 1.050,
  peak_multiplier DECIMAL(5,3) NOT NULL DEFAULT 1.100,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_pricing_settings_id CHECK (id = 1),
  CONSTRAINT chk_pricing_thresholds CHECK (
    demand_low_score < demand_normal_score AND
    demand_normal_score < demand_elevated_score AND
    availability_low_ratio < availability_medium_ratio
  )
) ENGINE=InnoDB;

INSERT INTO pricing_settings (id) VALUES (1)
  ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS demand_metrics (
  id CHAR(36) PRIMARY KEY,
  city_id VARCHAR(64) NOT NULL,
  category VARCHAR(40) NOT NULL,
  recent_bookings INT UNSIGNED NOT NULL,
  expected_bookings INT UNSIGNED NOT NULL,
  window_days SMALLINT UNSIGNED NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'SIMULATED_DEMO',
  measured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_demand_city FOREIGN KEY (city_id) REFERENCES cities(id),
  KEY idx_demand_scope_time (city_id, category, measured_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS peak_dates (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  city_id VARCHAR(64) NULL,
  location_id CHAR(36) NULL,
  multiplier DECIMAL(5,3) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_peak_city FOREIGN KEY (city_id) REFERENCES cities(id),
  CONSTRAINT fk_peak_location FOREIGN KEY (location_id) REFERENCES rental_locations(id),
  CONSTRAINT fk_peak_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_peak_period CHECK (ends_at > starts_at),
  KEY idx_peak_period (active, starts_at, ends_at, city_id, location_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS price_quotes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  vehicle_id CHAR(36) NOT NULL,
  pickup_at DATETIME(3) NOT NULL,
  return_at DATETIME(3) NOT NULL,
  breakdown JSON NOT NULL,
  final_total DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_quotes_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_quotes_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT chk_quote_period CHECK (return_at > pickup_at),
  CONSTRAINT chk_quote_total CHECK (final_total >= 0),
  KEY idx_quotes_user_expiry (user_id, expires_at),
  KEY idx_quotes_vehicle_period (vehicle_id, pickup_at, return_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservations (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  vehicle_id CHAR(36) NOT NULL,
  quote_id CHAR(36) NULL,
  pickup_at DATETIME(3) NOT NULL,
  return_at DATETIME(3) NOT NULL,
  status ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'EXPIRED')
    NOT NULL DEFAULT 'PENDING',
  total_price DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  hold_expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_reservations_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_reservations_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_reservations_quote FOREIGN KEY (quote_id) REFERENCES price_quotes(id),
  CONSTRAINT chk_reservation_period CHECK (return_at > pickup_at),
  CONSTRAINT chk_reservation_total CHECK (total_price >= 0),
  KEY idx_reservations_user_created (user_id, created_at),
  KEY idx_reservations_vehicle_period_status (vehicle_id, status, pickup_at, return_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_price_snapshots (
  id CHAR(36) PRIMARY KEY,
  reservation_id CHAR(36) NOT NULL UNIQUE,
  quote_id CHAR(36) NOT NULL,
  breakdown JSON NOT NULL,
  final_total DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_snapshot_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_snapshot_quote FOREIGN KEY (quote_id) REFERENCES price_quotes(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) PRIMARY KEY,
  reservation_id CHAR(36) NOT NULL UNIQUE,
  provider VARCHAR(20) NOT NULL DEFAULT 'MOCK',
  status ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
  amount DECIMAL(12,2) NOT NULL,
  transaction_ref VARCHAR(120) NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_payments_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT chk_payment_amount CHECK (amount >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS maintenance_periods (
  id CHAR(36) PRIMARY KEY,
  vehicle_id CHAR(36) NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  reason VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_maintenance_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT chk_maintenance_period CHECK (ends_at > starts_at),
  KEY idx_maintenance_vehicle_period (vehicle_id, starts_at, ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS price_history (
  id CHAR(36) PRIMARY KEY,
  vehicle_id CHAR(36) NOT NULL,
  base_daily_rate DECIMAL(12,2) NOT NULL,
  calculated_daily_rate DECIMAL(12,2) NOT NULL,
  multiplier DECIMAL(7,4) NOT NULL,
  reason VARCHAR(120) NOT NULL,
  recorded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_price_history_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  KEY idx_price_history_vehicle_time (vehicle_id, recorded_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id CHAR(36) NULL,
  details JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id),
  KEY idx_audit_logs_created (created_at),
  KEY idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;
