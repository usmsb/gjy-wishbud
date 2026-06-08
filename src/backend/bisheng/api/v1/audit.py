from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Query, Depends, Body
from pydantic import BaseModel

from bisheng.api.services.audit_log import AuditLogService
from bisheng.api.services.user_service import UserPayload, get_login_user
from bisheng.api.v1.schemas import UnifiedResponseModel, resp_200


class AuditLogCreate(BaseModel):
    """创建审计日志请求模型"""
    system_id: str
    event_type: str
    object_type: Optional[str] = "none"
    object_id: Optional[str] = ""
    object_name: Optional[str] = ""
    note: Optional[str] = ""

router = APIRouter(prefix='/audit', tags=['AuditLog'])


@router.get('')
def get_audit_logs(*,
                   group_ids: Optional[List[str]] = Query(default=[], description='分组id列表'),
                   operator_ids: Optional[List[int]] = Query(default=[], description='操作人id列表'),
                   start_time: Optional[datetime] = Query(default=None, description='开始时间'),
                   end_time: Optional[datetime] = Query(default=None, description='结束时间'),
                   system_id: Optional[str] = Query(default=None, description='系统模块'),
                   event_type: Optional[str] = Query(default=None, description='操作行为'),
                   page: Optional[int] = Query(default=0, description='页码'),
                   limit: Optional[int] = Query(default=0, description='每页条数'),
                   login_user: UserPayload = Depends(get_login_user)):
    group_ids = [one for one in group_ids if one]
    operator_ids = [one for one in operator_ids if one]
    return AuditLogService.get_audit_log(login_user, group_ids, operator_ids,
                                         start_time, end_time, system_id, event_type, page, limit)


@router.get('/operators')
def get_all_operators(*, login_user: UserPayload = Depends(get_login_user)):
    """
    获取操作过组下资源的所有用户
    """
    return AuditLogService.get_all_operators(login_user)


@router.get('/session')
def get_session_list(login_user: UserPayload = Depends(get_login_user),
                     flow_ids: Optional[List[str]] = Query(default=[], description='应用id列表'),
                     user_ids: Optional[List[int]] = Query(default=[], description='用户id列表'),
                     group_ids: Optional[List[int]] = Query(default=[], description='用户组id列表'),
                     start_date: Optional[datetime] = Query(default=None, description='开始时间'),
                     end_date: Optional[datetime] = Query(default=None, description='结束时间'),
                     feedback: Optional[str] = Query(default=None, description='like：点赞；dislike：点踩；copied：复制'),
                     sensitive_status: Optional[int] = Query(default=None, description='敏感词审查状态'),
                     page: Optional[int] = Query(default=1, description='页码'),
                     page_size: Optional[int] = Query(default=10, description='每页条数')):
    """ 筛选所有会话列表 """
    data, total = AuditLogService.get_session_list(login_user, flow_ids, user_ids, group_ids, start_date, end_date,
                                                   feedback, sensitive_status, page, page_size)
    return resp_200(data={
        'data': data,
        'total': total
    })


@router.get('/session/export')
def export_session_messages(login_user: UserPayload = Depends(get_login_user),
                            flow_ids: Optional[List[str]] = Query(default=[], description='应用id列表'),
                            user_ids: Optional[List[int]] = Query(default=[], description='用户id列表'),
                            group_ids: Optional[List[int]] = Query(default=[], description='用户组id列表'),
                            start_date: Optional[datetime] = Query(default=None, description='开始时间'),
                            end_date: Optional[datetime] = Query(default=None, description='结束时间'),
                            feedback: Optional[str] = Query(default=None,
                                                            description='like：点赞；dislike：点踩；copied：复制'),
                            sensitive_status: Optional[int] = Query(default=None, description='敏感词审查状态')):
    """ 导出会话详情列表的csv文件 """
    url = AuditLogService.export_session_messages(login_user, flow_ids, user_ids, group_ids, start_date, end_date,
                                                  feedback, sensitive_status)
    return resp_200(data={
        'url': url
    })


@router.get('/session/export/data')
def get_session_messages(login_user: UserPayload = Depends(get_login_user),
                         flow_ids: Optional[List[str]] = Query(default=[], description='应用id列表'),
                         user_ids: Optional[List[int]] = Query(default=[], description='用户id列表'),
                         group_ids: Optional[List[int]] = Query(default=[], description='用户组id列表'),
                         start_date: Optional[datetime] = Query(default=None, description='开始时间'),
                         end_date: Optional[datetime] = Query(default=None, description='结束时间'),
                         feedback: Optional[str] = Query(default=None,
                                                         description='like：点赞；dislike：点踩；copied：复制'),
                         sensitive_status: Optional[int] = Query(default=None, description='敏感词审查状态')):
    """ 导出会话详情列表的数据 """
    result = AuditLogService.get_session_messages(login_user, flow_ids, user_ids, group_ids, start_date, end_date,
                                               feedback, sensitive_status)
    return resp_200(data={
        'data': result
    })


@router.post('/create')
def create_audit_log(
    login_user: UserPayload = Depends(get_login_user),
    audit_data: AuditLogCreate = Body(...),
    x_forwarded_for: Optional[str] = Query(None, alias='X-Forwarded-For'),
    x_real_ip: Optional[str] = Query(None, alias='X-Real-IP')
):
    """
    创建审计日志
    用于前端记录功能点击使用记录
    """
    # 获取客户端IP地址
    ip_address = x_real_ip or x_forwarded_for.split(',')[0].strip() if x_forwarded_for else '127.0.0.1'
    return AuditLogService.create_audit_log(
        user=login_user,
        ip_address=ip_address,
        system_id=audit_data.system_id,
        event_type=audit_data.event_type,
        object_type=audit_data.object_type,
        object_id=audit_data.object_id,
        object_name=audit_data.object_name,
        note=audit_data.note
    )
