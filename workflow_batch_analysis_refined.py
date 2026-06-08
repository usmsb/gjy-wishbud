"""
批量文档分析模块 - 优化版本
用于在CodeNode中执行批量文档分析，获取相关文件的完整内容并进行分析
"""

from typing import Dict, List, Any
from bisheng.api.services.knowledge import KnowledgeService
from bisheng.api.services.knowledge_imp import async_read_chunk_text
from bisheng.database.models.knowledge_file import KnowledgeFileDao
import json


def main(arg1: str) -> dict:
    """
    批量文档分析主函数
    
    Args:
        arg1: JSON格式的输入参数，包含以下字段：
              - related_file_ids: RAG检索到的相关文件ID列表
              - file_title: 文件标题（可选）
              - knowledge_id: 知识库ID
    
    Returns:
        dict: 包含以下字段的结果字典：
              - result1: 主结果字典
                - related_file_ids: 相关文件ID列表
                - knowledge_id: 知识库ID
                - file_info: 文件ID到文件名的映射字典
                - all_chunks: 所有片段列表
                - chunk_summary: 按文件分组的片段摘要
                - total_chunks: 总片段数
                - processed_files: 已处理的文件数
                - error: 错误信息（如果有）
    """
    
    # 解析输入参数
    try:
        input_data = json.loads(arg1)
        related_file_ids = input_data.get("related_file_ids", [])
        file_title = input_data.get("file_title", "")
        knowledge_id = input_data.get("knowledge_id")
        
        # 处理related_file_ids可能是字符串或列表的情况
        if isinstance(related_file_ids, str):
            # 如果是字符串，尝试解析为列表（支持逗号分隔的字符串）
            if related_file_ids.strip():
                related_file_ids = [related_file_ids.strip()]
            else:
                related_file_ids = []
        elif isinstance(related_file_ids, list):
            # 确保列表中的元素都是字符串
            related_file_ids = [str(id) for id in related_file_ids]
        else:
            related_file_ids = []
        
        print(f"开始分析文件: {file_title}")
        print(f"相关文件ID: {related_file_ids}")
        print(f"知识库ID: {knowledge_id}")
        
    except json.JSONDecodeError as e:
        print(f"解析输入参数失败: {str(e)}")
        return {'result1': {"error": f"Invalid JSON format in arg1: {str(e)}"}}
    
    # 参数验证
    if not related_file_ids:
        print("没有找到相关文件ID")
        return {'result1': {"error": "No related file IDs provided"}}
    
    if knowledge_id is None:
        print("缺少知识库ID")
        return {'result1': {"error": "knowledge_id is required"}}
    
    # 初始化结果字典
    result1 = {
        "related_file_ids": related_file_ids,
        "knowledge_id": knowledge_id,
        "file_info": {},  # 文件ID到文件名的映射
        "all_chunks": [],  # 所有片段的列表
        "chunk_summary": {},  # 按文件分组的片段摘要
        "total_chunks": 0,  # 总片段数
        "processed_files": 0,  # 已处理的文件数
        "error": None  # 错误信息
    }
    
    try:
        # 1. 获取文件基本信息
        print("正在获取文件基本信息...")
        file_list = KnowledgeFileDao.get_file_by_ids(related_file_ids)
        
        if not file_list:
            print("未找到任何文件")
            result1["error"] = "No files found for the given IDs"
            return {'result1': result1}
        
        # 构建文件信息字典
        result1["file_info"] = {f.id: f.file_name for f in file_list}
        print(f"成功获取 {len(file_list)} 个文件信息")
        
        # 2. 批量获取所有文件的片段
        print("开始批量获取文件片段...")
        all_chunks = []
        
        for file_id in related_file_ids:
            try:
                print(f"正在处理文件 {file_id}...")
                
                # 获取文件的所有片段
                chunks, total = KnowledgeService.get_knowledge_chunks(
                    request=None,  # CodeNode环境下可能为None
                    login_user=None,  # CodeNode环境下可能为None
                    knowledge_id=knowledge_id,
                    file_ids=[file_id],
                    page=1,
                    limit=10000  # 较大的limit确保获取所有片段
                )
                
                print(f"文件 {file_id} 共找到 {len(chunks)} 个片段")
                
                # 组织文件片段信息
                file_chunks = []
                for chunk in chunks:
                    chunk_info = {
                        "file_id": file_id,
                        "file_name": result1["file_info"].get(file_id, "未知文件"),
                        "chunk_index": chunk.metadata.get("chunk_index", 0) if chunk.metadata else 0,
                        "text": chunk.text,
                        "title": chunk.metadata.get("title", "") if chunk.metadata else "",
                        "page": chunk.metadata.get("page", 0) if chunk.metadata else 0
                    }
                    file_chunks.append(chunk_info)
                    all_chunks.append(chunk_info)
                
                # 更新文件摘要信息
                result1["chunk_summary"][file_id] = {
                    "file_name": result1["file_info"].get(file_id, "未知文件"),
                    "chunk_count": len(file_chunks),
                    "chunks": file_chunks
                }
                
            except Exception as e:
                print(f"获取文件 {file_id} 片段失败: {str(e)}")
                # 继续处理其他文件，记录错误但不中断整个流程
                result1["chunk_summary"][file_id] = {
                    "file_name": result1["file_info"].get(file_id, "未知文件"),
                    "chunk_count": 0,
                    "chunks": [],
                    "error": str(e)
                }
                continue
        
        # 更新统计信息
        result1["all_chunks"] = all_chunks
        result1["total_chunks"] = len(all_chunks)
        result1["processed_files"] = len(result1["chunk_summary"])
        
        print(f"批量文档分析完成:")
        print(f"  - 处理文件数: {result1['processed_files']}")
        print(f"  - 总片段数: {result1['total_chunks']}")
        
    except Exception as e:
        print(f"批量文档分析过程中发生错误: {str(e)}")
        result1["error"] = f"Batch analysis failed: {str(e)}"
    
    return {'result1': result1}


def batch_analysis(all_chunks: List[Dict], analysis_type: str = "summary") -> Dict[str, Any]:
    """
    对所有片段进行批量分析
    
    Args:
        all_chunks: 所有片段列表
        analysis_type: 分析类型 (summary/concept_extraction/topics)
    
    Returns:
        Dict: 分析结果
    """
    if not all_chunks:
        return {"error": "No chunks to analyze"}
    
    analysis_result = {
        "analysis_type": analysis_type,
        "total_chunks": len(all_chunks),
        "analysis_time": "分析完成",
        "results": {}
    }
    
    if analysis_type == "summary":
        # 1. 按文件分组总结
        file_summaries = {}
        for chunk in all_chunks:
            file_id = chunk["file_id"]
            if file_id not in file_summaries:
                file_summaries[file_id] = {
                    "file_name": chunk["file_name"],
                    "content": [],
                    "chunk_count": 0
                }
            
            file_summaries[file_id]["content"].append(chunk["text"])
            file_summaries[file_id]["chunk_count"] += 1
        
        # 2. 生成每个文件的总结
        for file_id, file_data in file_summaries.items():
            full_text = "\n\n".join(file_data["content"])
            # 这里可以调用LLM进行总结
            summary = f"""
文件: {file_data['file_name']}
总片段数: {file_data['chunk_count']}
内容长度: {len(full_text)} 字符

内容摘要:
{full_text[:500]}{'...' if len(full_text) > 500 else ''}
            """
            analysis_result["results"][file_id] = summary
            
        # 3. 跨文件主题分析
        all_text = "\n\n".join([chunk["text"] for chunk in all_chunks])
        cross_file_summary = f"""
跨文件综合分析:
总片段数: {len(all_chunks)}
涉及文件数: {len(file_summaries)}
总内容长度: {len(all_text)} 字符

主要主题: 需要LLM分析确定
        """
        analysis_result["cross_file_summary"] = cross_file_summary
        
    elif analysis_type == "concept_extraction":
        # 概念提取
        all_text = "\n\n".join([chunk["text"] for chunk in all_chunks])
        concepts = {
            "关键概念": "需要LLM分析提取",
            "实体识别": "需要LLM识别",
            "关系抽取": "需要LLM分析"
        }
        analysis_result["results"] = concepts
        
    return analysis_result


def generate_comprehensive_report(file_analysis: Dict, batch_analysis_result: Dict) -> str:
    """
    生成综合分析报告
    
    Args:
        file_analysis: 文件分析结果
        batch_analysis_result: 批量分析结果
    
    Returns:
        str: 综合分析报告
    """
    if "error" in file_analysis:
        return f"分析过程中出现错误: {file_analysis['error']}"
    
    report = f"""
# 批量文档分析报告

## 用户问题
{file_analysis.get('user_question', 'N/A')}

## 检索结果统计
- 涉及文件数: {file_analysis.get('processed_files', 0)}
- 总片段数: {file_analysis.get('total_chunks', 0)}
- 知识库ID: {file_analysis.get('knowledge_id', 'N/A')}

## 文件级别分析
"""
    
    # 添加每个文件的分析结果
    for file_id, summary in file_analysis.get('chunk_summary', {}).items():
        preview_text = summary['chunks'][0]['text'][:100] if summary['chunks'] else '无内容'
        report += f"""
### {summary['file_name']}
- 片段数量: {summary['chunk_count']}
- 内容预览: {preview_text}...
- 状态: {'成功' if 'error' not in summary else f"失败: {summary.get('error', '未知错误')}"}
"""

    # 添加跨文件分析结果
    if 'cross_file_summary' in batch_analysis_result:
        report += f"""
## 跨文件综合分析
{batch_analysis_result['cross_file_summary']}
"""

    report += f"""
## 分析完成
分析时间: {batch_analysis_result.get('analysis_time', '')}
分析类型: {batch_analysis_result.get('analysis_type', '')}
"""
    
    return report


def test_main():
    """测试函数"""
    test_input = {
        "related_file_ids": [1, 2, 3],
        "file_title": "测试文档集",
        "knowledge_id": 123
    }
    
    test_arg1 = json.dumps(test_input, ensure_ascii=False)
    
    print("开始测试批量文档分析功能...")
    result = main(test_arg1)
    print(f"测试结果: {json.dumps(result, ensure_ascii=False, indent=2)}")


if __name__ == "__main__":
    # 测试代码
    test_main()