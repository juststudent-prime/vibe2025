CREATE DATABASE todolist;
USE todolist;

-- Таблица пользователей для аутентификации
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    telegram_id VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица задач с привязкой к пользователю
CREATE TABLE items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    text VARCHAR(255) NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Создание пользователя БД с расширенными привилегиями
CREATE USER 'todo_user'@'localhost' IDENTIFIED BY '1234';
GRANT ALL PRIVILEGES ON todolist.* TO 'todo_user'@'localhost';
FLUSH PRIVILEGES;

-- Опционально: индекс для ускорения поиска задач пользователя
CREATE INDEX idx_items_user_id ON items(user_id);
-- Индекс для telegram_id
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
