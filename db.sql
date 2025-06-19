CREATE DATABASE todolist;
USE todolist;

CREATE TABLE items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    text VARCHAR(255) NOT NULL
);

CREATE USER 'todo_user'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON todolist.* TO 'todo_user'@'localhost';
FLUSH PRIVILEGES;
