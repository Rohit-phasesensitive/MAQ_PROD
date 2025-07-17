import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv
from contextlib import contextmanager
import logging

load_dotenv()

# Database configuration
DATABASE_CONFIG = {
    "host": os.getenv("DATABASE_HOST", "localhost"),
    "port": os.getenv("DATABASE_PORT", "5432"),
    "database": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
}

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DatabaseManager:
    def __init__(self):
        self.config = DATABASE_CONFIG
        
    def get_connection(self):
        """Get a database connection"""
        try:
            conn = psycopg2.connect(**self.config)
            return conn
        except psycopg2.Error as e:
            logger.error(f"Database connection error: {e}")
            raise
    
    @contextmanager
    def get_cursor(self, cursor_factory=RealDictCursor):
        """Context manager for database cursor"""
        conn = None
        cursor = None
        try:
            conn = self.get_connection()
            cursor = conn.cursor(cursor_factory=cursor_factory)
            yield cursor
            conn.commit()
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()

# Global database manager instance
db_manager = DatabaseManager()

# Convenience function for getting cursor
def get_db_cursor():
    return db_manager.get_cursor()

# Test database connection
def test_connection():
    """Test database connection"""
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT 1")
            result = cursor.fetchone()
            logger.info("Database connection successful")
            return True
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return False