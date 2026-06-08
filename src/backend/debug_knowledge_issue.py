#!/usr/bin/env python3
"""
Debug script to analyze knowledge base blocking issue
"""
import sys
import os
import logging
from datetime import datetime

# Add the project root to path
sys.path.insert(0, '/Users/gujun/Downloads/bisheng-main')

from bisheng_langchain.vectorstores.milvus import Milvus
from bisheng_langchain.vectorstores.elastic_keywords_search import ElasticKeywordsSearch
from bisheng.api.services.knowledge_imp import decide_vectorstores
from bisheng.interface.embeddings.custom import FakeEmbedding

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_milvus_connection():
    """Test Milvus connection and insertion performance"""
    logger.info("Testing Milvus connection...")
    
    # Create fake embedding
    embedding = FakeEmbedding()
    
    # Create vector store client
    vector_client = decide_vectorstores("test_collection", "Milvus", embedding)
    
    logger.info(f"Created Milvus client: {type(vector_client)}")
    logger.info(f"Collection: {vector_client.collection_name}")
    logger.info(f"Alias: {vector_client.alias}")
    
    # Test insertion
    texts = [f"Test text {i}" for i in range(10)]
    metadatas = [{"test_key": f"test_value_{i}"} for i in range(10)]
    
    start_time = datetime.now()
    logger.info("Starting Milvus insertion...")
    
    try:
        result = vector_client.add_texts(texts, metadatas, no_embedding=True)
        logger.info(f"Milvus insertion completed successfully: {result}")
        logger.info(f"Insertion time: {datetime.now() - start_time}")
    except Exception as e:
        logger.error(f"Milvus insertion failed: {e}")
    
    # Test search
    start_time = datetime.now()
    logger.info("Starting Milvus search...")
    
    try:
        result = vector_client.similarity_search("test query", k=5)
        logger.info(f"Milvus search completed successfully: {len(result)} results")
        logger.info(f"Search time: {datetime.now() - start_time}")
    except Exception as e:
        logger.error(f"Milvus search failed: {e}")

def test_elasticsearch_connection():
    """Test Elasticsearch connection and insertion performance"""
    logger.info("Testing Elasticsearch connection...")
    
    # Create fake embedding
    embedding = FakeEmbedding()
    
    # Create ES client
    es_client = decide_vectorstores("test_index", "ElasticKeywordsSearch", embedding)
    
    logger.info(f"Created Elasticsearch client: {type(es_client)}")
    logger.info(f"Index: {es_client.index_name}")
    
    # Test insertion
    texts = [f"Test text {i}" for i in range(10)]
    metadatas = [{"test_key": f"test_value_{i}"} for i in range(10)]
    
    start_time = datetime.now()
    logger.info("Starting Elasticsearch insertion...")
    
    try:
        result = es_client.add_texts(texts, metadatas)
        logger.info(f"Elasticsearch insertion completed successfully: {result}")
        logger.info(f"Insertion time: {datetime.now() - start_time}")
    except Exception as e:
        logger.error(f"Elasticsearch insertion failed: {e}")

if __name__ == "__main__":
    logger.info("Starting knowledge base blocking issue analysis...")
    
    test_milvus_connection()
    test_elasticsearch_connection()
    
    logger.info("Analysis completed.")
