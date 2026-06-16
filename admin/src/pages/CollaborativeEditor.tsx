import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Layout,
  List,
  Button,
  Space,
  Alert,
  Modal,
  Input,
  message,
  Popconfirm,
  Dropdown,
  MenuProps,
  Badge,
  Tag,
} from 'antd';
import {
  EditOutlined,
  SaveOutlined,
  SendOutlined,
  UnlockOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  HistoryOutlined,
  UserOutlined,
  WifiOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import SDLEditor from '../components/SDLEditor';
import ActivityTimeline from '../components/ActivityTimeline';
import OnlineUsers from '../components/OnlineUsers';
import useWebSocket from '../hooks/useWebSocket';
import { useAuth } from '../store/auth';
import {
  getSubgraphs,
  getCurrentSchema,
  getDraft,
  saveDraft,
  deleteDraft,
  getDrafts,
  getLockStatus,
  acquireLock,
  releaseLock,
  refreshLock,
  cancelWait,
  getActivityLogs,
  validateSDL,
  getOnlineUsers,
  submitChange,
} from '../api/collaboration';
import {
  Subgraph,
  LockStatus,
  ActivityLog,
  SyntaxValidationResult,
  Draft as DraftType,
  NotificationMessage,
} from '../types/collaboration';
import dayjs from 'dayjs';

const { Sider, Content } = Layout;
const { TextArea } = Input;

const CollaborativeEditor: React.FC = () => {
  const { user } = useAuth();
  const [subgraphs, setSubgraphs] = useState<Subgraph[]>([]);
  const [selectedSubgraph, setSelectedSubgraph] = useState<Subgraph | null>(null);
  const [sdl, setSdl] = useState('');
  const [originalSdl, setOriginalSdl] = useState('');
  const [validation, setValidation] = useState<SyntaxValidationResult | null>(null);
  const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [activityOffset, setActivityOffset] = useState(0);
  const [viewers, setViewers] = useState<Array<{ userId: string; userName: string; userEmail: string }>>([]);
  const [drafts, setDrafts] = useState<DraftType[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [draftsModalVisible, setDraftsModalVisible] = useState(false);
  const [submitModalVisible, setSubmitModalVisible] = useState(false);
  const [changelog, setChangelog] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const lastEditTime = useRef<number>(0);
  const validationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockRefreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleWebSocketMessage = useCallback(async (notification: NotificationMessage) => {
    if (!selectedSubgraph) return;

    if (notification.type === 'lock_status_changed' && notification.subgraphId === selectedSubgraph.id) {
      setLockStatus(notification.payload.lockStatus);
      
      if (notification.payload.lockStatus.holder?.userId === user?.id) {
        const draft = await getDraft(selectedSubgraph.id);
        if (draft) {
          Modal.confirm({
            title: '检测到草稿',
            content: '发现你之前保存的草稿，是否恢复？',
            okText: '恢复',
            cancelText: '忽略',
            onOk: () => {
              setSdl(draft.sdl);
              setHasUnsavedChanges(true);
              message.success('草稿已恢复');
            },
          });
        }
      }
    }

    if (notification.type === 'user_presence_changed' && notification.payload.subgraphId === selectedSubgraph.id && notification.payload.viewers) {
      setViewers(notification.payload.viewers);
    }

    if (notification.type === 'activity_logged' && notification.subgraphId === selectedSubgraph.id) {
      setActivityLogs((prev) => [notification.payload.activity, ...prev].slice(0, 50));
    }

    if (notification.type === 'approval_status_changed') {
      message.success(`Schema ${notification.subgraphName} 审批状态已更新: ${notification.payload.newStatus}`);
    }

    if (notification.type === 'supergraph_published') {
      message.success(`SuperGraph v${notification.payload.version} 已发布`);
    }

    if (notification.type === 'subgraph_health_alert') {
      message.warning(`SubGraph ${notification.subgraphName} 健康告警: ${notification.payload.alertType}`);
    }

    if (notification.type === 'grayscale_progress') {
      console.log('Grayscale progress:', notification.payload);
    }
  }, [selectedSubgraph, user?.id]);

  const { isConnected, subscribeToSubgraph, unsubscribeFromSubgraph } = useWebSocket({
    onMessage: handleWebSocketMessage,
  });

  useEffect(() => {
    loadSubgraphs();
    loadDrafts();
  }, []);

  useEffect(() => {
    if (selectedSubgraph) {
      subscribeToSubgraph(selectedSubgraph.id);
      loadSubgraphData(selectedSubgraph.id);
      
      return () => {
        unsubscribeFromSubgraph(selectedSubgraph.id);
      };
    }
  }, [selectedSubgraph]);

  useEffect(() => {
    if (sdl !== originalSdl) {
      setHasUnsavedChanges(true);
      lastEditTime.current = Date.now();
    }
  }, [sdl, originalSdl]);

  useEffect(() => {
    if (validationTimeout.current) {
      clearTimeout(validationTimeout.current);
    }
    if (sdl) {
      validationTimeout.current = setTimeout(async () => {
        try {
          const result = await validateSDL(sdl);
          setValidation(result);
        } catch (err: any) {
          console.error('Validation error:', err);
          setValidation({
            valid: false,
            errors: [{
              line: 1,
              column: 1,
              message: err?.response?.data?.error || err?.message || '校验服务不可用',
            }],
          });
        }
      }, 300);
    } else {
      setValidation({ valid: true });
    }
    return () => {
      if (validationTimeout.current) {
        clearTimeout(validationTimeout.current);
      }
    };
  }, [sdl]);

  useEffect(() => {
    if (selectedSubgraph && lockStatus?.holder?.userId === user?.id) {
      lockRefreshInterval.current = setInterval(() => {
        if (Date.now() - lastEditTime.current < 300000) {
          refreshLock(selectedSubgraph.id);
        }
      }, 60000);
    }
    return () => {
      if (lockRefreshInterval.current) {
        clearInterval(lockRefreshInterval.current);
      }
    };
  }, [selectedSubgraph, lockStatus?.holder?.userId, user?.id]);

  const loadSubgraphs = async () => {
    try {
      const data = await getSubgraphs();
      setSubgraphs(data);
    } catch (err) {
      message.error('加载SubGraph列表失败');
    }
  };

  const loadDrafts = async () => {
    setDraftsLoading(true);
    setDraftsError(null);
    try {
      const data = await getDrafts();
      setDrafts(data);
    } catch (err: any) {
      console.error('Load drafts error:', err);
      setDraftsError(err?.response?.data?.error || '加载草稿失败');
    } finally {
      setDraftsLoading(false);
    }
  };

  const loadSubgraphData = async (subgraphId: string) => {
    setIsLoading(true);
    try {
      const [schemaResult, lockResult, activityResult, onlineResult] = await Promise.allSettled([
        getCurrentSchema(subgraphId),
        getLockStatus(subgraphId),
        getActivityLogs(subgraphId, 50, 0),
        getOnlineUsers(subgraphId),
      ]);

      if (schemaResult.status === 'fulfilled') {
        setSdl(schemaResult.value.sdl || '');
        setOriginalSdl(schemaResult.value.sdl || '');
      } else {
        console.error('Load schema error:', schemaResult.reason);
        setSdl('');
        setOriginalSdl('');
      }
      setHasUnsavedChanges(false);

      if (lockResult.status === 'fulfilled') {
        setLockStatus(lockResult.value);
      }

      if (activityResult.status === 'fulfilled') {
        setActivityLogs(activityResult.value.logs);
        setHasMoreLogs(activityResult.value.hasMore);
        setActivityOffset(50);
      }

      if (onlineResult.status === 'fulfilled') {
        setViewers(onlineResult.value);
      }
    } catch (err) {
      console.error('Load subgraph data error:', err);
      message.error('加载Schema数据失败');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreLogs = async () => {
    if (!selectedSubgraph || activityLoading) return;
    
    setActivityLoading(true);
    try {
      const activity = await getActivityLogs(selectedSubgraph.id, 50, activityOffset);
      setActivityLogs((prev) => [...prev, ...activity.logs]);
      setHasMoreLogs(activity.hasMore);
      setActivityOffset((prev) => prev + 50);
    } catch (err) {
      console.error('Load more logs error:', err);
    } finally {
      setActivityLoading(false);
    }
  };

  const handleSubgraphSelect = async (subgraph: Subgraph) => {
    if (selectedSubgraph && hasUnsavedChanges && lockStatus?.holder?.userId === user?.id) {
      const result = await Modal.confirm({
        title: '有未保存的更改',
        content: '是否保存当前SubGraph的更改？',
        okText: '保存草稿',
        cancelText: '放弃更改',
      });
      if (result) {
        await handleSaveDraft();
      }
    }
    setSelectedSubgraph(subgraph);
  };

  const handleAcquireLock = async () => {
    if (!selectedSubgraph) return;
    
    try {
      const result = await acquireLock(selectedSubgraph.id);
      if (result.success) {
        message.success(result.message);
      } else {
        message.warning(result.message);
      }
      const lock = await getLockStatus(selectedSubgraph.id);
      setLockStatus(lock);
    } catch (err: any) {
      message.error(err?.response?.data?.error || '获取编辑权失败');
    }
  };

  const handleReleaseLock = async (saveDraftFlag?: boolean) => {
    if (!selectedSubgraph) return;
    
    try {
      if (saveDraftFlag && hasUnsavedChanges) {
        await saveDraft(selectedSubgraph.id, sdl);
        message.success('草稿已保存');
      }
      
      const result = await releaseLock(selectedSubgraph.id, saveDraftFlag);
      message.success(result.message);
      setHasUnsavedChanges(false);
    } catch (err: any) {
      message.error(err?.response?.data?.error || '释放编辑权失败');
    } finally {
      try {
        const lock = await getLockStatus(selectedSubgraph.id);
        setLockStatus(lock);
      } catch {}
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedSubgraph || !lockStatus?.holder || lockStatus.holder.userId !== user?.id) {
      message.error('你没有编辑权，无法保存');
      return;
    }

    try {
      await saveDraft(selectedSubgraph.id, sdl);
      message.success('草稿已保存');
      setHasUnsavedChanges(false);
      loadDrafts();
    } catch (err) {
      message.error('保存草稿失败');
    }
  };

  const handleSubmit = async () => {
    if (!selectedSubgraph || !lockStatus?.holder || lockStatus.holder.userId !== user?.id) {
      message.error('你没有编辑权，无法提交');
      return;
    }

    if (!validation?.valid) {
      message.error('SDL语法有误，请先修正错误');
      return;
    }

    if (!changelog.trim()) {
      message.error('请填写变更说明');
      return;
    }

    try {
      await submitChange(selectedSubgraph.id, sdl, changelog.trim());
      message.success('变更已提交，等待审批');
      setSubmitModalVisible(false);
      setChangelog('');
      setLockStatus(await getLockStatus(selectedSubgraph.id));
      setHasUnsavedChanges(false);
      setOriginalSdl(sdl);
    } catch (err: any) {
      message.error(err.response?.data?.error || '提交失败');
    }
  };

  const handleRestoreDraft = async (draft: DraftType) => {
    const subgraph = subgraphs.find(s => s.id === draft.subgraph_id);
    if (subgraph) {
      setSelectedSubgraph(subgraph);
      setSdl(draft.sdl);
      setHasUnsavedChanges(true);
      setDraftsModalVisible(false);
      message.success('草稿已恢复');
    }
  };

  const handleDeleteDraft = async (subgraphId: string) => {
    try {
      await deleteDraft(subgraphId);
      message.success('草稿已删除');
      loadDrafts();
    } catch (err) {
      message.error('删除草稿失败');
    }
  };

  const handleCancelWait = async () => {
    if (!selectedSubgraph) return;
    try {
      await cancelWait(selectedSubgraph.id);
      message.success('已取消等待');
      setLockStatus(await getLockStatus(selectedSubgraph.id));
    } catch (err) {
      message.error('取消等待失败');
    }
  };

  const isLockHolder = useMemo(() => {
    return lockStatus?.holder?.userId === user?.id;
  }, [lockStatus?.holder?.userId, user?.id]);

  const isInWaitQueue = useMemo(() => {
    if (!lockStatus || !user) return null;
    return lockStatus.waitingQueue.find(w => w.userId === user.id) || null;
  }, [lockStatus, user]);

  const getDraftsMenuItems = (): MenuProps['items'] => {
    if (draftsLoading) {
      return [
        {
          key: 'loading',
          label: <div style={{ padding: '12px 16px', color: '#8c8c8c', textAlign: 'center' }}>加载中...</div>,
          disabled: true,
        },
      ];
    }

    if (draftsError) {
      return [
        {
          key: 'error',
          label: (
            <div style={{ padding: '12px 16px', textAlign: 'center' }}>
              <div style={{ color: '#ff4d4f', marginBottom: 8 }}>{draftsError}</div>
              <Button size="small" onClick={loadDrafts}>重试</Button>
            </div>
          ),
          disabled: true,
        },
      ];
    }

    if (drafts.length === 0) {
      return [
        {
          key: 'empty',
          label: <div style={{ padding: '20px 16px', color: '#8c8c8c', textAlign: 'center' }}>暂无草稿</div>,
          disabled: true,
        },
      ];
    }

    return drafts.map((draft) => ({
      key: draft.id,
      label: (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 300 }}>
          <div>
            <div style={{ fontWeight: 'bold' }}>{draft.subgraph_name || draft.subgraph_id}</div>
            <div style={{ fontSize: '12px', color: '#8c8c8c' }}>
              更新于 {dayjs(draft.updated_at).format('YYYY-MM-DD HH:mm')}
            </div>
          </div>
          <Space>
            <Button size="small" onClick={() => handleRestoreDraft(draft)}>恢复</Button>
            <Popconfirm
              title="确定删除这个草稿？"
              onConfirm={() => handleDeleteDraft(draft.subgraph_id)}
            >
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        </div>
      ),
    }));
  };

  const draftsMenu: MenuProps = {
    items: getDraftsMenuItems(),
  };

  const getLockBanner = () => {
    if (!lockStatus || !selectedSubgraph) return null;

    if (lockStatus.isLocked && lockStatus.holder) {
      if (isLockHolder) {
        return (
          <Alert
            type="success"
            showIcon
            icon={<EditOutlined />}
            message={
              <Space>
                <span>你正在编辑此Schema</span>
                <Badge status="processing" text="编辑权持有中" />
              </Space>
            }
            action={
              <Space>
                <Button size="small" icon={<SaveOutlined />} onClick={handleSaveDraft}>
                  保存草稿
                </Button>
                <Button
                  size="small"
                  icon={<UnlockOutlined />}
                  onClick={() => {
                    if (hasUnsavedChanges) {
                      Modal.confirm({
                        title: '释放编辑权',
                        content: '内容有变更，是否保存为草稿？',
                        okText: '保存并释放',
                        cancelText: '放弃修改',
                        onOk: () => handleReleaseLock(true),
                        onCancel: () => handleReleaseLock(false),
                      });
                    } else {
                      handleReleaseLock(false);
                    }
                  }}
                >
                  释放编辑权
                </Button>
              </Space>
            }
            style={{ marginBottom: 16 }}
          />
        );
      }

      if (isInWaitQueue) {
        return (
          <Alert
            type="warning"
            showIcon
            icon={<ClockCircleOutlined />}
            message={
              <Space>
                <span>{lockStatus.holder.userName} 正在编辑中</span>
                <Badge status="warning" text={`你是第 ${isInWaitQueue.position} 位等待者`} />
              </Space>
            }
            action={
              <Button size="small" onClick={handleCancelWait}>
                取消等待
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        );
      }

      return (
        <Alert
          type="warning"
          showIcon
          icon={<UserOutlined />}
          message={`${lockStatus.holder.userName} 正在编辑中，当前为只读模式`}
          action={
            <Button type="primary" size="small" icon={<EditOutlined />} onClick={handleAcquireLock}>
              请求编辑权
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      );
    }

    return (
      <Alert
        type="info"
        showIcon
        icon={<UnlockOutlined />}
        message="当前无人编辑，你可以获取编辑权"
        action={
          <Button type="primary" size="small" icon={<EditOutlined />} onClick={handleAcquireLock}>
            获取编辑权
          </Button>
        }
        style={{ marginBottom: 16 }}
      />
    );
  };

  return (
    <Layout style={{ height: 'calc(100vh - 112px)', background: '#fff' }}>
      <Sider
        width={250}
        style={{ background: '#fafafa', borderRight: '1px solid #e8e8e8' }}
      >
        <div style={{ padding: 16, borderBottom: '1px solid #e8e8e8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>SubGraph 列表</h3>
            <Space>
              <Dropdown menu={draftsMenu} trigger={['click']}>
                <Button size="small" icon={<FileTextOutlined />}>
                  我的草稿 {drafts.length > 0 && <Badge count={drafts.length} size="small" />}
                </Button>
              </Dropdown>
              <Space size={4}>
                {isConnected ? (
                  <WifiOutlined style={{ color: '#52c41a' }} title="已连接" />
                ) : (
                  <DisconnectOutlined style={{ color: '#ff4d4f' }} title="断开连接" />
                )}
              </Space>
            </Space>
          </div>
          <Input.Search placeholder="搜索SubGraph..." allowClear />
        </div>
        <List
          dataSource={subgraphs}
          renderItem={(subgraph) => (
            <List.Item
              key={subgraph.id}
              onClick={() => handleSubgraphSelect(subgraph)}
              style={{
                cursor: 'pointer',
                padding: '12px 16px',
                background: selectedSubgraph?.id === subgraph.id ? '#e6f7ff' : 'transparent',
                borderLeft: selectedSubgraph?.id === subgraph.id ? '3px solid #1890ff' : '3px solid transparent',
              }}
            >
              <List.Item.Meta
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: selectedSubgraph?.id === subgraph.id ? 'bold' : 'normal' }}>
                      {subgraph.name}
                    </span>
                    {subgraph.is_active ? (
                      <Tag color="green">活跃</Tag>
                    ) : (
                      <Tag color="default">停用</Tag>
                    )}
                  </div>
                }
                description={
                  <div style={{ fontSize: '12px', color: '#8c8c8c' }}>
                    <div>{subgraph.owner_team}</div>
                    <div style={{ wordBreak: 'break-all' }}>{subgraph.routing_url}</div>
                  </div>
                }
              />
            </List.Item>
          )}
          style={{ height: 'calc(100% - 80px)', overflow: 'auto' }}
        />
      </Sider>

      <Layout style={{ display: 'flex', flexDirection: 'column' }}>
        {selectedSubgraph ? (
          <>
            <div style={{ padding: '16px 16px 0 16px', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: 0 }}>{selectedSubgraph.name}</h2>
                  <div style={{ color: '#8c8c8c', fontSize: '13px', marginTop: 4 }}>
                    {selectedSubgraph.description || '无描述'}
                  </div>
                </div>
                <Space>
                  {isLockHolder && (
                    <>
                      <Button icon={<SaveOutlined />} onClick={handleSaveDraft} disabled={!hasUnsavedChanges}>
                        保存草稿
                      </Button>
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={() => setSubmitModalVisible(true)}
                        disabled={!hasUnsavedChanges || !validation?.valid}
                      >
                        提交变更
                      </Button>
                    </>
                  )}
                </Space>
              </div>

              {getLockBanner()}
            </div>

            <Content style={{ padding: '0 16px', flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <SDLEditor
                  value={sdl}
                  onChange={setSdl}
                  readOnly={!isLockHolder}
                  validation={validation}
                  height={400}
                />

                <div style={{ marginTop: 16, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <HistoryOutlined /> 活动流
                    </h3>
                    <span style={{ color: '#8c8c8c', fontSize: '12px' }}>
                      最近 {activityLogs.length} 条记录
                    </span>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', border: '1px solid #e8e8e8', borderRadius: 4, padding: '0 16px' }}>
                    <ActivityTimeline
                      logs={activityLogs}
                      loading={activityLoading}
                      hasMore={hasMoreLogs}
                      onLoadMore={loadMoreLogs}
                    />
                  </div>
                </div>
              </div>

              <div style={{ width: 200, paddingLeft: 16, flexShrink: 0 }}>
                <OnlineUsers users={viewers} currentUserId={user?.id} />
              </div>
            </Content>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8c8c8c' }}>
            <div style={{ textAlign: 'center' }}>
              <FileTextOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <div>请从左侧选择一个SubGraph开始编辑</div>
            </div>
          </div>
        )}
      </Layout>

      <Modal
        title="提交变更"
        open={submitModalVisible}
        onOk={handleSubmit}
        onCancel={() => setSubmitModalVisible(false)}
        confirmLoading={isLoading}
        okText="提交审批"
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 'bold' }}>变更说明 (changelog)</div>
          <TextArea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            placeholder="请详细描述本次变更的内容和原因..."
            rows={4}
            maxLength={500}
            showCount
          />
        </div>
        {hasUnsavedChanges && (
          <Alert
            type="info"
            showIcon
            message={`将提交 ${sdl.split('\n').length} 行SDL变更`}
          />
        )}
      </Modal>
    </Layout>
  );
};

export default CollaborativeEditor;
