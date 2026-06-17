import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Layout,
  Card,
  Tag,
  Button,
  Space,
  Input,
  DatePicker,
  Select,
  Tooltip,
  Modal,
  Tabs,
  List,
  Statistic,
  Row,
  Col,
  Progress,
  Alert,
  Empty,
  Spin,
  Checkbox,
  Table,
  message,
} from 'antd';
import {
  HistoryOutlined,
  DiffOutlined,
  PlayCircleOutlined,
  RollbackOutlined,
  SearchOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ClockCircleOutlined,
  UserOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  DashboardOutlined,
  InfoCircleOutlined,
  BellOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  LoadingOutlined,
  CloseOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  SchemaVersion,
  VersionTimelineResult,
  CanaryRelease,
  CanaryMetricsSummary,
  VersionCompareResult,
  ReleaseAuditLog,
} from '../types/version-management';
import {
  getVersionsTimeline,
  getVersionDetail,
  getActiveCanary,
  getCanaryMetrics,
  getCanaryMetricsTimeSeries,
  compareVersions,
  startCanaryRelease,
  adjustCanaryPercent,
  rollbackCanary,
  fullReleaseCanary,
  checkCanaryAutoFullRelease,
  getReleaseAuditLogs,
  getCanaryById,
  getCanaryReleases,
  exportReleaseAuditCsv,
} from '../api/version-management';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import useWebSocket from '../hooks/useWebSocket';
import { NotificationMessage } from '../types/collaboration';

const { RangePicker } = DatePicker;
const { Option } = Select;
const { TabPane } = Tabs;

const VersionManagement: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [timelineData, setTimelineData] = useState<VersionTimelineResult[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<SchemaVersion | null>(null);
  const [selectedSubgraphId, setSelectedSubgraphId] = useState<string | null>(null);
  const [searchName, setSearchName] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [zoom, setZoom] = useState(1);
  const timelineRef = useRef<HTMLDivElement>(null);

  const [activeCanary, setActiveCanary] = useState<CanaryRelease | null>(null);
  const [canaryMetrics, setCanaryMetrics] = useState<CanaryMetricsSummary | null>(null);
  const [canaryMetricsTimeSeries, setCanaryMetricsTimeSeries] = useState<any>(null);
  const [canaryLoading, setCanaryLoading] = useState(false);
  const [showErrorAlert, setShowErrorAlert] = useState(false);
  const [canFullRelease, setCanFullRelease] = useState(false);

  const [compareModalVisible, setCompareModalVisible] = useState(false);
  const [compareVersionIds, setCompareVersionIds] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<VersionCompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const [startCanaryModalVisible, setStartCanaryModalVisible] = useState(false);
  const [initialPercent, setInitialPercent] = useState(10);
  const [activeTab, setActiveTab] = useState('timeline');

  const [auditLogs, setAuditLogs] = useState<ReleaseAuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSubgraphName, setAuditSubgraphName] = useState('');
  const [auditActionType, setAuditActionType] = useState<string | undefined>();
  const [auditDateRange, setAuditDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [auditDetailModalVisible, setAuditDetailModalVisible] = useState(false);
  const [selectedAuditLog, setSelectedAuditLog] = useState<ReleaseAuditLog | null>(null);
  const [auditCanaryDetail, setAuditCanaryDetail] = useState<CanaryRelease | null>(null);
  const [auditCanaryLoading, setAuditCanaryLoading] = useState(false);

  const [canaryNotifications, setCanaryNotifications] = useState<any[]>([]);
  const [expandedSubgraphs, setExpandedSubgraphs] = useState<Set<string>>(new Set());
  const [allCanaryReleases, setAllCanaryReleases] = useState<CanaryRelease[]>([]);

  const metricsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { send, isConnected } = useWebSocket({
    onMessage: handleWebSocketMessage,
  });

  function handleWebSocketMessage(message: NotificationMessage) {
    if (message.type === 'grayscale_progress' && message.payload) {
      const subgraphId = message.payload.subgraphId;
      if (subgraphId === selectedSubgraphId) {
        loadActiveCanary(subgraphId);
        if (message.payload.status === 'rolled_back') {
          setShowErrorAlert(true);
        }
      }
      if (message.payload.actionType) {
        const newNotification = {
          id: Date.now() + Math.random(),
          actionType: message.payload.actionType || 'unknown',
          subgraphName: message.payload.subgraphName || message.subgraphName || '未知',
          operator: message.payload.operator || message.payload.startedBy || '未知用户',
          currentPercent: message.payload.currentPercent,
          timestamp: message.timestamp,
          status: message.payload.status,
        };
        setCanaryNotifications((prev) => {
          const updated = [newNotification, ...prev];
          return updated.slice(0, 5);
        });
      }
    }
    if (message.type === 'approval_status_changed' && message.payload) {
      const subgraphId = message.payload.subgraphId;
      if (subgraphId === selectedSubgraphId && selectedVersion) {
        loadVersionDetail(selectedVersion.id);
      }
    }
  }

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (searchName) {
        params.subgraphName = searchName;
      }
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.startTime = dateRange[0].toISOString();
        params.endTime = dateRange[1].toISOString();
      }
      const data = await getVersionsTimeline(params);
      setTimelineData(data);

      const initialExpanded = new Set<string>();
      data.slice(0, 3).forEach((sg) => initialExpanded.add(sg.subgraphId));
      setExpandedSubgraphs(initialExpanded);

      const canaryResult = await getCanaryReleases({ limit: 100 });
      setAllCanaryReleases(canaryResult.rows);
    } catch (err: any) {
      message.error('加载版本时间线失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [searchName, dateRange]);

  const loadVersionDetail = useCallback(async (versionId: string) => {
    try {
      const version = await getVersionDetail(versionId);
      setSelectedVersion(version);
      setSelectedSubgraphId(version.subgraph_id);
      loadActiveCanary(version.subgraph_id);
    } catch (err: any) {
      message.error('加载版本详情失败: ' + err.message);
    }
  }, []);

  const loadActiveCanary = useCallback(async (subgraphId: string) => {
    setCanaryLoading(true);
    try {
      const canary = await getActiveCanary(subgraphId);
      setActiveCanary(canary);
      if (canary && canary.status === 'canary') {
        loadCanaryMetrics(canary.id);
        loadCanaryMetricsTimeSeries(canary.id);
        startMetricsPolling(canary.id);
        checkAutoFullRelease(canary.id);
      } else {
        stopMetricsPolling();
        setCanaryMetrics(null);
        setCanaryMetricsTimeSeries(null);
        setShowErrorAlert(false);
      }
    } catch (err: any) {
      console.error('加载灰度发布信息失败:', err);
    } finally {
      setCanaryLoading(false);
    }
  }, []);

  const loadCanaryMetrics = async (canaryId: string) => {
    try {
      const metrics = await getCanaryMetrics(canaryId);
      setCanaryMetrics(metrics);
      if (metrics.newVersion.errorRate > 5) {
        setShowErrorAlert(true);
      }
    } catch (err: any) {
      console.error('加载灰度指标失败:', err);
    }
  };

  const loadCanaryMetricsTimeSeries = async (canaryId: string) => {
    try {
      const data = await getCanaryMetricsTimeSeries(canaryId, 30);
      setCanaryMetricsTimeSeries(data);
    } catch (err: any) {
      console.error('加载灰度指标时间序列失败:', err);
    }
  };

  const checkAutoFullRelease = async (canaryId: string) => {
    try {
      const canRelease = await checkCanaryAutoFullRelease(canaryId);
      setCanFullRelease(canRelease);
    } catch (err: any) {
      console.error('检查自动全量发布条件失败:', err);
    }
  };

  const startMetricsPolling = (canaryId: string) => {
    stopMetricsPolling();
    metricsIntervalRef.current = setInterval(() => {
      loadCanaryMetrics(canaryId);
      loadCanaryMetricsTimeSeries(canaryId);
      checkAutoFullRelease(canaryId);
    }, 10000);
  };

  const stopMetricsPolling = () => {
    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
      metricsIntervalRef.current = null;
    }
  };

  useEffect(() => {
    loadTimeline();
    return () => {
      stopMetricsPolling();
    };
  }, [loadTimeline]);

  const handleVersionClick = (version: SchemaVersion) => {
    setSelectedVersion(version);
    setSelectedSubgraphId(version.subgraph_id);
    loadActiveCanary(version.subgraph_id);
  };

  const handleCompareClick = () => {
    if (compareVersionIds.length !== 2) {
      message.warning('请选择两个版本进行对比');
      return;
    }
    doCompare();
  };

  const doCompare = async () => {
    setCompareLoading(true);
    try {
      const result = await compareVersions(compareVersionIds[0], compareVersionIds[1]);
      setCompareResult(result);
      setCompareModalVisible(true);
    } catch (err: any) {
      message.error('版本对比失败: ' + err.message);
    } finally {
      setCompareLoading(false);
    }
  };

  const handleVersionCheckboxChange = (versionId: string, checked: boolean) => {
    if (checked) {
      if (compareVersionIds.length < 2) {
        setCompareVersionIds([...compareVersionIds, versionId]);
      } else {
        message.warning('最多只能选择两个版本进行对比');
      }
    } else {
      setCompareVersionIds(compareVersionIds.filter((v) => v !== versionId));
    }
  };

  const handleStartCanary = async () => {
    if (!selectedVersion) return;
    try {
      const canary = await startCanaryRelease({
        subgraphId: selectedVersion.subgraph_id,
        newVersionId: selectedVersion.id,
        initialPercent,
      });
      setActiveCanary(canary);
      setStartCanaryModalVisible(false);
      message.success('灰度发布已启动');
      loadCanaryMetrics(canary.id);
      startMetricsPolling(canary.id);
    } catch (err: any) {
      message.error('启动灰度发布失败: ' + err.message);
    }
  };

  const handleAdjustPercent = async (newPercent: number) => {
    if (!activeCanary) return;
    try {
      const canary = await adjustCanaryPercent(activeCanary.id, newPercent, '手动调整');
      setActiveCanary(canary);
      message.success(`灰度比例已调整为 ${newPercent}%`);
    } catch (err: any) {
      message.error('调整灰度比例失败: ' + err.message);
    }
  };

  const handleRollback = async () => {
    if (!activeCanary) return;
    Modal.confirm({
      title: '确认回滚',
      content: '确定要立即回滚吗？所有流量将切回旧版本。',
      okText: '立即回滚',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const canary = await rollbackCanary(activeCanary.id, '手动回滚');
          setActiveCanary(canary);
          setShowErrorAlert(false);
          message.success('已成功回滚');
        } catch (err: any) {
          message.error('回滚失败: ' + err.message);
        }
      },
    });
  };

  const handleFullRelease = async () => {
    if (!activeCanary) return;
    Modal.confirm({
      title: '确认全量发布',
      content: '确定要全量发布吗？所有流量将切到新版本。',
      okText: '全量发布',
      onOk: async () => {
        try {
          const canary = await fullReleaseCanary(activeCanary.id, '手动全量发布');
          setActiveCanary(canary);
          message.success('已全量发布');
        } catch (err: any) {
          message.error('全量发布失败: ' + err.message);
        }
      },
    });
  };

  const getCompatibilityTagColor = (compatibility: string) => {
    return compatibility === 'BREAKING' ? 'red' : 'green';
  };

  const getCanaryStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: '待发布',
      canary: '灰度中',
      full_rollout: '已全量',
      rolled_back: '已回滚',
      failed: '失败',
    };
    return statusMap[status] || status;
  };

  const getCanaryStatusColor = (status: string) => {
    const colorMap: Record<string, string> = {
      pending: 'default',
      canary: 'blue',
      full_rollout: 'green',
      rolled_back: 'red',
      failed: 'red',
    };
    return colorMap[status] || 'default';
  };

  const formatDuration = (startTime: string) => {
    const start = dayjs(startTime);
    const now = dayjs();
    const diff = now.diff(start, 'second');
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    if (hours > 0) {
      return `${hours}小时${minutes}分${seconds}秒`;
    }
    if (minutes > 0) {
      return `${minutes}分${seconds}秒`;
    }
    return `${seconds}秒`;
  };

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params: any = {
        limit: auditPageSize,
        offset: (auditPage - 1) * auditPageSize,
      };
      if (auditActionType) {
        params.actionType = auditActionType;
      }
      if (auditDateRange && auditDateRange[0] && auditDateRange[1]) {
        params.startTime = auditDateRange[0].toISOString();
        params.endTime = auditDateRange[1].toISOString();
      }
      const result = await getReleaseAuditLogs(params);
      
      if (auditSubgraphName) {
        const filtered = result.rows.filter((log) =>
          log.subgraph_name.toLowerCase().includes(auditSubgraphName.toLowerCase())
        );
        setAuditLogs(filtered);
        setAuditTotal(filtered.length);
      } else {
        setAuditLogs(result.rows);
        setAuditTotal(result.total);
      }
    } catch (err: any) {
      message.error('加载发布记录失败: ' + err.message);
    } finally {
      setAuditLoading(false);
    }
  }, [auditPage, auditPageSize, auditActionType, auditDateRange, auditSubgraphName]);

  const handleExportCsv = async () => {
    try {
      const params: any = {};
      if (auditActionType) {
        params.actionType = auditActionType;
      }
      if (auditDateRange && auditDateRange[0] && auditDateRange[1]) {
        params.startTime = auditDateRange[0].toISOString();
        params.endTime = auditDateRange[1].toISOString();
      }
      await exportReleaseAuditCsv(params);
      message.success('导出成功');
    } catch (err: any) {
      message.error('导出失败: ' + err.message);
    }
  };

  const handleAuditSearch = () => {
    setAuditPage(1);
    loadAuditLogs();
  };

  const handleViewAuditDetail = async (log: ReleaseAuditLog) => {
    setSelectedAuditLog(log);
    setAuditDetailModalVisible(true);
    
    if (log.canary_release_id) {
      setAuditCanaryLoading(true);
      try {
        const canary = await getCanaryById(log.canary_release_id);
        setAuditCanaryDetail(canary);
      } catch (err: any) {
        console.error('加载灰度详情失败:', err);
      } finally {
        setAuditCanaryLoading(false);
      }
    } else {
      setAuditCanaryDetail(null);
    }
  };

  const getActionTypeText = (type: string) => {
    const typeMap: Record<string, string> = {
      start_canary: '启动灰度',
      adjust_percent: '调整比例',
      full_release: '全量发布',
      rollback: '回滚',
      version_published: '版本发布',
    };
    return typeMap[type] || type;
  };

  const getActionTypeColor = (type: string) => {
    const colorMap: Record<string, string> = {
      start_canary: 'blue',
      adjust_percent: 'cyan',
      full_release: 'green',
      rollback: 'red',
      version_published: 'purple',
    };
    return colorMap[type] || 'default';
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'start_canary':
        return <PlayCircleOutlined />;
      case 'adjust_percent':
        return <RocketOutlined />;
      case 'full_release':
        return <CheckCircleOutlined />;
      case 'rollback':
        return <RollbackOutlined />;
      default:
        return <InfoCircleOutlined />;
    }
  };

  const getCanaryActionText = (actionType: string) => {
    const typeMap: Record<string, string> = {
      start_canary: '发起灰度',
      adjust_percent: '调整比例',
      full_release: '全量发布',
      rollback: '回滚',
      unknown: '未知操作',
    };
    return typeMap[actionType] || actionType || '未知操作';
  };

  const getCanaryActionColor = (actionType: string) => {
    const colorMap: Record<string, string> = {
      start_canary: 'blue',
      adjust_percent: 'cyan',
      full_release: 'green',
      rollback: 'red',
    };
    return colorMap[actionType] || 'default';
  };

  const getVersionStatus = (version: SchemaVersion): 'active' | 'canary' | 'rolled_back' | 'historical' => {
    if (version.is_active) return 'active';

    const canaryForVersion = allCanaryReleases.find(
      (c) => c.new_version_id === version.id
    );

    if (canaryForVersion) {
      if (canaryForVersion.status === 'canary' || canaryForVersion.status === 'pending') {
        return 'canary';
      }
      if (canaryForVersion.status === 'rolled_back') {
        return 'rolled_back';
      }
    }

    return 'historical';
  };

  const getVersionStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      active: '当前活跃',
      canary: '灰度中',
      rolled_back: '已回滚',
      historical: '历史版本',
    };
    return statusMap[status] || status;
  };

  const handleToggleSubgraph = (subgraphId: string) => {
    setExpandedSubgraphs((prev) => {
      const next = new Set(prev);
      if (next.has(subgraphId)) {
        next.delete(subgraphId);
      } else {
        next.add(subgraphId);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    const all = new Set(timelineData.map((sg) => sg.subgraphId));
    setExpandedSubgraphs(all);
  };

  const handleCollapseAll = () => {
    setExpandedSubgraphs(new Set());
  };

  const prepareChartData = (timeSeries: any, metricKey: string) => {
    if (!timeSeries) return [];

    const oldData = timeSeries.oldVersion || [];
    const newData = timeSeries.newVersion || [];

    const timeMap = new Map<string, { oldVersion: number; newVersion: number }>();

    oldData.forEach((item: any) => {
      const time = dayjs(item.timestamp).format('HH:mm');
      timeMap.set(time, { oldVersion: item[metricKey] ?? 0, newVersion: 0 });
    });

    newData.forEach((item: any) => {
      const time = dayjs(item.timestamp).format('HH:mm');
      const existing = timeMap.get(time) || { oldVersion: 0, newVersion: 0 };
      timeMap.set(time, { ...existing, newVersion: item[metricKey] ?? 0 });
    });

    const sortedTimes = Array.from(timeMap.keys()).sort();
    return sortedTimes.map((time) => ({
      time,
      oldVersion: timeMap.get(time)!.oldVersion,
      newVersion: timeMap.get(time)!.newVersion,
    }));
  };

  const renderCanaryNotifications = () => {
    if (canaryNotifications.length === 0) return null;

    return (
      <div
        style={{
          position: 'fixed',
          top: 80,
          right: 24,
          zIndex: 1000,
          width: 320,
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 16px',
              background: '#f0f5ff',
              borderBottom: '1px solid #e8e8e8',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            <Space>
              <BellOutlined />
              灰度操作通知
            </Space>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {canaryNotifications.map((notif) => (
              <div
                key={notif.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Tag color={getCanaryActionColor(notif.actionType)} icon={getActionIcon(notif.actionType)}>
                      {getCanaryActionText(notif.actionType)}
                    </Tag>
                    <span style={{ fontSize: 11, color: '#999' }}>
                      {dayjs(notif.timestamp).format('HH:mm:ss')}
                    </span>
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <strong>{notif.subgraphName}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    操作人: {notif.operator}
                  </div>
                  {notif.currentPercent !== undefined && (
                    <div style={{ fontSize: 12, color: '#1890ff' }}>
                      当前灰度: {notif.currentPercent}%
                    </div>
                  )}
                </Space>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderTimeline = () => {
    if (loading) {
      return (
        <div style={{ textAlign: 'center', padding: '100px 0' }}>
          <Spin size="large" />
        </div>
      );
    }

    if (timelineData.length === 0) {
      return <Empty description="暂无版本数据" />;
    }

    const allExpanded = timelineData.every((sg) => expandedSubgraphs.has(sg.subgraphId));
    const hasMoreThan3 = timelineData.length > 3;

    return (
      <div>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            {hasMoreThan3 && (
              <>
                <Button size="small" onClick={handleExpandAll} disabled={allExpanded}>
                  展开全部
                </Button>
                <Button size="small" onClick={handleCollapseAll} disabled={!allExpanded}>
                  收起全部
                </Button>
              </>
            )}
          </Space>
        </div>
        <div
          ref={timelineRef}
          style={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 360px)',
          }}
        >
          <div style={{ minWidth: `${800 * zoom}px`, padding: '20px 0' }}>
            {timelineData.map((subgraph) => {
              const isExpanded = expandedSubgraphs.has(subgraph.subgraphId);

              return (
                <div key={subgraph.subgraphId} style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: 8,
                      paddingLeft: 12,
                      cursor: 'pointer',
                    }}
                    onClick={() => handleToggleSubgraph(subgraph.subgraphId)}
                  >
                    {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                    <h3 style={{ margin: 0, marginLeft: 8, fontSize: 16, fontWeight: 600 }}>
                      {subgraph.subgraphName}
                    </h3>
                    <Tag style={{ marginLeft: 8 }}>{subgraph.versions.length} 个版本</Tag>
                  </div>
                  {isExpanded && (
                    <div
                      style={{
                        position: 'relative',
                        height: 60,
                        borderBottom: '2px solid #e8e8e8',
                        marginLeft: 60,
                        marginRight: 60,
                      }}
                    >
                      {subgraph.versions.map((version, index) => {
                        const position =
                          subgraph.versions.length > 1
                            ? (index / (subgraph.versions.length - 1)) * 100
                            : 50;
                        const isSelected = selectedVersion?.id === version.id;
                        const status = getVersionStatus(version);

                        const renderStatusIcon = () => {
                          const baseStyle: React.CSSProperties = {
                            width: 16,
                            height: 16,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          };

                          switch (status) {
                            case 'active':
                              return (
                                <div
                                  style={{
                                    ...baseStyle,
                                    borderRadius: '50%',
                                    backgroundColor: '#52c41a',
                                  }}
                                />
                              );
                            case 'canary':
                              return (
                                <div
                                  style={{
                                    ...baseStyle,
                                    color: '#1890ff',
                                  }}
                                >
                                  <LoadingOutlined spin style={{ fontSize: 18 }} />
                                </div>
                              );
                            case 'rolled_back':
                              return (
                                <div
                                  style={{
                                    ...baseStyle,
                                    color: '#ff4d4f',
                                  }}
                                >
                                  <CloseOutlined style={{ fontSize: 18 }} />
                                </div>
                              );
                            default:
                              return (
                                <div
                                  style={{
                                    ...baseStyle,
                                    borderRadius: '50%',
                                    backgroundColor: '#bfbfbf',
                                  }}
                                />
                              );
                          }
                        };

                        return (
                          <div
                            key={version.id}
                            style={{
                              position: 'absolute',
                              left: `${position}%`,
                              transform: 'translateX(-50%)',
                              top: -8,
                              cursor: 'pointer',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleVersionClick(version);
                            }}
                          >
                            <Tooltip
                              title={
                                <div>
                                  <div>
                                    <strong>{version.version_string}</strong>
                                  </div>
                                  <div>
                                    发布时间:{' '}
                                    {dayjs(version.published_at).format(
                                      'YYYY-MM-DD HH:mm:ss'
                                    )}
                                  </div>
                                  <div>当前状态: {getVersionStatusText(status)}</div>
                                  <div>发布人: {version.published_by || '未知'}</div>
                                  <div>兼容性: {version.compatibility}</div>
                                </div>
                              }
                            >
                              <div
                                style={{
                                  position: 'relative',
                                  border: isSelected
                                    ? '3px solid #1890ff'
                                    : '2px solid #fff',
                                  boxShadow: isSelected ? '0 0 0 2px #91d5ff' : 'none',
                                  borderRadius: '50%',
                                  transition: 'all 0.2s',
                                }}
                              >
                                {renderStatusIcon()}
                              </div>
                            </Tooltip>
                            <div
                              style={{
                                position: 'absolute',
                                top: 20,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                whiteSpace: 'nowrap',
                                fontSize: 11,
                                color: isSelected ? '#1890ff' : '#666',
                                fontWeight: isSelected ? 600 : 400,
                              }}
                            >
                              {version.version_string}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderVersionDetail = () => {
    if (!selectedVersion) {
      return (
        <div style={{ textAlign: 'center', padding: '100px 0', color: '#999' }}>
          <HistoryOutlined style={{ fontSize: 48, marginBottom: 16 }} />
          <div>请选择一个版本查看详情</div>
        </div>
      );
    }

    const isApproved = selectedVersion.approval?.status === 'approved';
    const canStartCanary = isApproved && activeCanary?.status !== 'canary' && activeCanary?.status !== 'pending';

    return (
      <div>
        <Card
          title={
            <Space>
              <span>{selectedVersion.version_string}</span>
              <Tag color={getCompatibilityTagColor(selectedVersion.compatibility)}>
                {selectedVersion.compatibility}
              </Tag>
              {selectedVersion.is_active && <Tag color="green">当前活跃</Tag>}
              {isApproved && <Tag color="green" icon={<CheckCircleOutlined />}>可发起灰度发布</Tag>}
            </Space>
          }
          extra={
            <Space>
              <Checkbox
                checked={compareVersionIds.includes(selectedVersion.id)}
                onChange={(e) =>
                  handleVersionCheckboxChange(selectedVersion.id, e.target.checked)
                }
              >
                对比
              </Checkbox>
              <Tooltip title={isApproved ? '' : '该版本未通过审批,无法发起灰度发布'}>
                <Button
                  type="primary"
                  icon={<RocketOutlined />}
                  onClick={() => setStartCanaryModalVisible(true)}
                  disabled={!canStartCanary}
                >
                  灰度发布
                </Button>
              </Tooltip>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic
                  title="发布时间"
                  value={dayjs(selectedVersion.published_at).format('YYYY-MM-DD HH:mm:ss')}
                  prefix={<ClockCircleOutlined />}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="发布人"
                  value={selectedVersion.published_by || '未知'}
                  prefix={<UserOutlined />}
                />
              </Col>
            </Row>

            <div>
              <h4 style={{ marginBottom: 8 }}>变更日志</h4>
              <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                <List
                  size="small"
                  dataSource={[
                    ...selectedVersion.change_summary?.breakingChanges?.map((c) => ({ ...c, type: 'BREAKING' })) || [],
                    ...selectedVersion.change_summary?.nonBreakingChanges?.map((c) => ({ ...c, type: 'COMPATIBLE' })) || [],
                    ...selectedVersion.change_summary?.dangerousChanges?.map((c) => ({ ...c, type: 'WARNING' })) || [],
                  ]}
                  renderItem={(item: any) => (
                    <List.Item>
                      <Space>
                        <Tag color={item.type === 'BREAKING' ? 'red' : item.type === 'WARNING' ? 'orange' : 'green'}>
                          {item.type}
                        </Tag>
                        <span>{item.description}</span>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            </div>

            <div>
              <h4 style={{ marginBottom: 8 }}>SDL 内容</h4>
              <pre
                style={{
                  background: '#f5f5f5',
                  padding: 12,
                  borderRadius: 4,
                  maxHeight: 300,
                  overflow: 'auto',
                  fontSize: 12,
                  fontFamily: 'Monaco, Menlo, monospace',
                }}
              >
                {selectedVersion.sdl}
              </pre>
            </div>
          </Space>
        </Card>
      </div>
    );
  };

  const renderCanaryPanel = () => {
    if (!selectedSubgraphId) {
      return null;
    }

    if (canaryLoading) {
      return (
        <Card style={{ marginTop: 16 }}>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin />
          </div>
        </Card>
      );
    }

    if (!activeCanary) {
      return (
        <Card title="灰度发布" style={{ marginTop: 16 }}>
          <Empty description="暂无进行中的灰度发布" />
        </Card>
      );
    }

    const isCanaryActive = activeCanary.status === 'canary';

    return (
      <Card
        title={
          <Space>
            <span>灰度发布</span>
            <Tag color={getCanaryStatusColor(activeCanary.status)}>
              {getCanaryStatusText(activeCanary.status)}
            </Tag>
          </Space>
        }
        style={{ marginTop: 16 }}
        extra={
          isCanaryActive && (
            <Space>
              <Button danger icon={<RollbackOutlined />} onClick={handleRollback}>
                立即回滚
              </Button>
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleFullRelease}>
                全量发布
              </Button>
            </Space>
          )
        }
      >
        {showErrorAlert && (
          <Alert
            message="新版本错误率异常，建议回滚"
            type="error"
            showIcon
            icon={<WarningOutlined />}
            style={{ marginBottom: 16 }}
          />
        )}

        {canFullRelease && isCanaryActive && (
          <Alert
            message="条件已满足，可全量发布"
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            action={
              <Button size="small" type="primary" onClick={handleFullRelease}>
                立即全量发布
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}

        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Statistic
                title="当前灰度比例"
                value={activeCanary.current_percent}
                suffix="%"
                valueStyle={{ color: isCanaryActive ? '#1890ff' : undefined }}
              />
              <Progress percent={activeCanary.current_percent} style={{ marginTop: 8 }} />
            </Col>
            <Col span={12}>
              <Statistic
                title="灰度已持续"
                value={formatDuration(activeCanary.started_at)}
                prefix={<ClockCircleOutlined />}
              />
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <div>
                <div style={{ color: '#8c8c8c', marginBottom: 4 }}>旧版本 ({activeCanary.old_version_string})</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: '#52c41a' }}>
                  {100 - activeCanary.current_percent}%
                </div>
              </div>
            </Col>
            <Col span={12}>
              <div>
                <div style={{ color: '#8c8c8c', marginBottom: 4 }}>新版本 ({activeCanary.new_version_string})</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: '#1890ff' }}>
                  {activeCanary.current_percent}%
                </div>
              </div>
            </Col>
          </Row>

          {canaryMetricsTimeSeries && (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Card size="small" title="请求量趋势 (最近30分钟)">
                <div style={{ height: 120 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={prepareChartData(canaryMetricsTimeSeries, 'requestCount')}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 10 }} 
                        tickFormatter={(v) => v}
                      />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RechartsTooltip 
                        formatter={(value: any, name: string) => [
                          value,
                          name === 'newVersion' ? '新版本' : '旧版本'
                        ]}
                        labelFormatter={(label) => `时间: ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="oldVersion"
                        stroke="#bfbfbf"
                        strokeWidth={2}
                        dot={false}
                        name="oldVersion"
                      />
                      <Line
                        type="monotone"
                        dataKey="newVersion"
                        stroke="#1890ff"
                        strokeWidth={2}
                        dot={false}
                        name="newVersion"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#666' }}>
                    <span style={{ display: 'inline-block', width: 12, height: 2, background: '#bfbfbf', marginRight: 6, verticalAlign: 'middle' }}></span>
                    旧版本
                  </span>
                  <span style={{ fontSize: 12, color: '#666' }}>
                    <span style={{ display: 'inline-block', width: 12, height: 2, background: '#1890ff', marginRight: 6, verticalAlign: 'middle' }}></span>
                    新版本
                  </span>
                </div>
              </Card>

              <Card size="small" title="错误率趋势 (最近30分钟)">
                <div style={{ height: 120, position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={prepareChartData(canaryMetricsTimeSeries, 'errorRate')}>
                      <defs>
                        <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ff4d4f" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#ff4d4f" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 10 }} 
                        tickFormatter={(v) => v}
                      />
                      <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                      <ReferenceLine y={5} stroke="#ff4d4f" strokeDasharray="5 5" label={{ value: '5%阈值', fill: '#ff4d4f', fontSize: 10, position: 'insideTopRight' }} />
                      <RechartsTooltip 
                        formatter={(value: any, name: string) => [
                          `${value.toFixed(2)}%`,
                          name === 'newVersion' ? '新版本' : '旧版本'
                        ]}
                        labelFormatter={(label) => `时间: ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="oldVersion"
                        stroke="#bfbfbf"
                        strokeWidth={2}
                        dot={false}
                        name="oldVersion"
                      />
                      <Line
                        type="monotone"
                        dataKey="newVersion"
                        stroke="#1890ff"
                        strokeWidth={2}
                        dot={false}
                        name="newVersion"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#666' }}>
                    <span style={{ display: 'inline-block', width: 12, height: 2, background: '#bfbfbf', marginRight: 6, verticalAlign: 'middle' }}></span>
                    旧版本
                  </span>
                  <span style={{ fontSize: 12, color: '#666' }}>
                    <span style={{ display: 'inline-block', width: 12, height: 2, background: '#1890ff', marginRight: 6, verticalAlign: 'middle' }}></span>
                    新版本
                  </span>
                  <span style={{ fontSize: 12, color: '#ff4d4f' }}>
                    <span style={{ display: 'inline-block', width: 12, height: 2, background: '#ff4d4f', marginRight: 6, verticalAlign: 'middle' }}></span>
                    阈值线
                  </span>
                </div>
              </Card>
            </Space>
          )}

          {isCanaryActive && (
            <div>
              <div style={{ marginBottom: 8 }}>调整灰度比例:</div>
              <Space wrap>
                {[10, 25, 50, 75, 100].map((percent) => (
                  <Button
                    key={percent}
                    type={activeCanary.current_percent === percent ? 'primary' : 'default'}
                    onClick={() => handleAdjustPercent(percent)}
                  >
                    {percent}%
                  </Button>
                ))}
              </Space>
            </div>
          )}

          <div>
            <div style={{ marginBottom: 8 }}>灰度比例调整轨迹:</div>
            <List
              size="small"
              dataSource={activeCanary.percent_history?.slice().reverse() || []}
              renderItem={(item) => (
                <List.Item>
                  <Space>
                    <Tag color="blue">{item.percent}%</Tag>
                    <span>{dayjs(item.changedAt).format('YYYY-MM-DD HH:mm:ss')}</span>
                    <span style={{ color: '#8c8c8c' }}>{item.reason}</span>
                  </Space>
                </List.Item>
              )}
            />
          </div>
        </Space>
      </Card>
    );
  };

  const renderCompareModal = () => (
    <Modal
      title="版本对比"
      open={compareModalVisible}
      onCancel={() => setCompareModalVisible(false)}
      width="90vw"
      style={{ top: 20 }}
      bodyStyle={{ height: 'calc(100vh - 200px)', padding: 0, overflow: 'hidden' }}
      footer={null}
    >
      {compareLoading ? (
        <div style={{ textAlign: 'center', padding: 100 }}>
          <Spin size="large" />
        </div>
      ) : compareResult ? (
        <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
            <Space>
              <span><strong>旧版本:</strong> {compareResult.oldVersion.version_string}</span>
              <span>→</span>
              <span><strong>新版本:</strong> {compareResult.newVersion.version_string}</span>
              <Tag color={compareResult.changes.breakingChanges.length > 0 ? 'red' : 'green'}>
                {compareResult.changes.breakingChanges.length > 0 ? '破坏性变更' : '兼容变更'}
              </Tag>
            </Space>
          </div>
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, borderRight: '1px solid #e8e8e8', overflow: 'auto' }}>
              <div style={{ padding: '8px 16px', background: '#fff1f0', fontWeight: 'bold', color: '#8c8c8c' }}>
                旧版本
              </div>
              <pre style={{ padding: 16, margin: 0, fontFamily: 'Monaco, Menlo, monospace', fontSize: 12 }}>
                {compareResult.oldVersion.sdl}
              </pre>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ padding: '8px 16px', background: '#f6ffed', fontWeight: 'bold', color: '#8c8c8c' }}>
                新版本
              </div>
              <pre style={{ padding: 16, margin: 0, fontFamily: 'Monaco, Menlo, monospace', fontSize: 12 }}>
                {compareResult.newVersion.sdl}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );

  const renderStartCanaryModal = () => (
    <Modal
      title="启动灰度发布"
      open={startCanaryModalVisible}
      onCancel={() => setStartCanaryModalVisible(false)}
      onOk={handleStartCanary}
      okText="开始灰度"
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>选择初始灰度比例:</div>
        <Select value={initialPercent} onChange={setInitialPercent} style={{ width: 200 }}>
          <Option value={10}>10%</Option>
          <Option value={25}>25%</Option>
          <Option value={50}>50%</Option>
          <Option value={75}>75%</Option>
          <Option value={100}>100%</Option>
        </Select>
      </div>
      <div style={{ color: '#8c8c8c', fontSize: 12 }}>
        灰度发布将按设置的比例将流量逐步切换到新版本 {selectedVersion?.version_string}
      </div>
    </Modal>
  );

  const renderAuditTable = () => {
    const columns = [
      {
        title: '操作时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 180,
        render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
      },
      {
        title: '操作类型',
        dataIndex: 'action_type',
        key: 'action_type',
        width: 120,
        render: (type: string) => (
          <Tag color={getActionTypeColor(type)} icon={getActionIcon(type)}>
            {getActionTypeText(type)}
          </Tag>
        ),
      },
      {
        title: 'SubGraph',
        dataIndex: 'subgraph_name',
        key: 'subgraph_name',
        width: 150,
      },
      {
        title: '版本变更',
        key: 'version',
        width: 200,
        render: (_: any, record: ReleaseAuditLog) => {
          if (record.old_version_string && record.new_version_string) {
            return (
              <Space>
                <Tag color="default">{record.old_version_string}</Tag>
                <span>→</span>
                <Tag color="blue">{record.new_version_string}</Tag>
              </Space>
            );
          }
          return '-';
        },
      },
      {
        title: '灰度比例变化',
        key: 'percent',
        width: 150,
        render: (_: any, record: ReleaseAuditLog) => {
          if (record.old_percent !== undefined && record.new_percent !== undefined) {
            return (
              <Space>
                <span>{record.old_percent}%</span>
                <span>→</span>
                <span style={{ color: record.new_percent > record.old_percent ? '#52c41a' : '#ff4d4f' }}>
                  {record.new_percent}%
                </span>
              </Space>
            );
          }
          return '-';
        },
      },
      {
        title: '操作人',
        dataIndex: 'operator',
        key: 'operator',
        width: 120,
      },
      {
        title: '原因',
        dataIndex: 'reason',
        key: 'reason',
        ellipsis: true,
        render: (text: string) => (
          <Tooltip title={text}>{text || '-'}</Tooltip>
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: 80,
        render: (_: any, record: ReleaseAuditLog) => (
          <Button type="link" onClick={() => handleViewAuditDetail(record)}>
            详情
          </Button>
        ),
      },
    ];

    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Input
              placeholder="搜索 SubGraph 名称"
              prefix={<SearchOutlined />}
              value={auditSubgraphName}
              onChange={(e) => setAuditSubgraphName(e.target.value)}
              style={{ width: 200 }}
              onPressEnter={handleAuditSearch}
            />
            <Select
              placeholder="操作类型"
              value={auditActionType}
              onChange={setAuditActionType}
              style={{ width: 150 }}
              allowClear
            >
              <Option value="start_canary">启动灰度</Option>
              <Option value="adjust_percent">调整比例</Option>
              <Option value="full_release">全量发布</Option>
              <Option value="rollback">回滚</Option>
              <Option value="version_published">版本发布</Option>
            </Select>
            <RangePicker
              value={auditDateRange as any}
              onChange={(dates) => setAuditDateRange(dates as any)}
              style={{ width: 280 }}
            />
            <Button type="primary" onClick={handleAuditSearch}>
              筛选
            </Button>
          </Space>
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={auditLogs}
          loading={auditLoading}
          pagination={{
            current: auditPage,
            pageSize: auditPageSize,
            total: auditTotal,
            onChange: (p, ps) => {
              setAuditPage(p);
              setAuditPageSize(ps);
            },
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条记录`,
          }}
        />
      </div>
    );
  };

  const renderAuditDetailModal = () => (
    <Modal
      title="发布记录详情"
      open={auditDetailModalVisible}
      onCancel={() => setAuditDetailModalVisible(false)}
      footer={null}
      width={600}
    >
      {selectedAuditLog && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <h4 style={{ marginBottom: 8 }}>基本信息</h4>
            <List size="small">
              <List.Item>
                <span style={{ color: '#8c8c8c', width: 100 }}>操作时间:</span>
                <span>{dayjs(selectedAuditLog.created_at).format('YYYY-MM-DD HH:mm:ss')}</span>
              </List.Item>
              <List.Item>
                <span style={{ color: '#8c8c8c', width: 100 }}>操作类型:</span>
                <Tag color={getActionTypeColor(selectedAuditLog.action_type)}>
                  {getActionTypeText(selectedAuditLog.action_type)}
                </Tag>
              </List.Item>
              <List.Item>
                <span style={{ color: '#8c8c8c', width: 100 }}>SubGraph:</span>
                <span>{selectedAuditLog.subgraph_name}</span>
              </List.Item>
              <List.Item>
                <span style={{ color: '#8c8c8c', width: 100 }}>操作人:</span>
                <span>{selectedAuditLog.operator}</span>
              </List.Item>
              {selectedAuditLog.old_version_string && selectedAuditLog.new_version_string && (
                <List.Item>
                  <span style={{ color: '#8c8c8c', width: 100 }}>版本变更:</span>
                  <Space>
                    <Tag color="default">{selectedAuditLog.old_version_string}</Tag>
                    <span>→</span>
                    <Tag color="blue">{selectedAuditLog.new_version_string}</Tag>
                  </Space>
                </List.Item>
              )}
              {selectedAuditLog.old_percent !== undefined && selectedAuditLog.new_percent !== undefined && (
                <List.Item>
                  <span style={{ color: '#8c8c8c', width: 100 }}>灰度比例:</span>
                  <Space>
                    <span>{selectedAuditLog.old_percent}%</span>
                    <span>→</span>
                    <span>{selectedAuditLog.new_percent}%</span>
                  </Space>
                </List.Item>
              )}
              {selectedAuditLog.reason && (
                <List.Item>
                  <span style={{ color: '#8c8c8c', width: 100 }}>原因:</span>
                  <span>{selectedAuditLog.reason}</span>
                </List.Item>
              )}
            </List>
          </div>

          {selectedAuditLog.canary_release_id && (
            <div>
              <h4 style={{ marginBottom: 8 }}>灰度发布详情</h4>
              {auditCanaryLoading ? (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <Spin />
                </div>
              ) : auditCanaryDetail ? (
                <List size="small">
                  <List.Item>
                    <span style={{ color: '#8c8c8c', width: 100 }}>状态:</span>
                    <Tag color={getCanaryStatusColor(auditCanaryDetail.status)}>
                      {getCanaryStatusText(auditCanaryDetail.status)}
                    </Tag>
                  </List.Item>
                  <List.Item>
                    <span style={{ color: '#8c8c8c', width: 100 }}>当前比例:</span>
                    <span>{auditCanaryDetail.current_percent}%</span>
                  </List.Item>
                  <List.Item>
                    <span style={{ color: '#8c8c8c', width: 100 }}>发起人:</span>
                    <span>{auditCanaryDetail.started_by}</span>
                  </List.Item>
                  <List.Item>
                    <span style={{ color: '#8c8c8c', width: 100 }}>开始时间:</span>
                    <span>{dayjs(auditCanaryDetail.started_at).format('YYYY-MM-DD HH:mm:ss')}</span>
                  </List.Item>
                  {auditCanaryDetail.completed_at && (
                    <List.Item>
                      <span style={{ color: '#8c8c8c', width: 100 }}>结束时间:</span>
                      <span>{dayjs(auditCanaryDetail.completed_at).format('YYYY-MM-DD HH:mm:ss')}</span>
                    </List.Item>
                  )}
                  {auditCanaryDetail.rollback_reason && (
                    <List.Item>
                      <span style={{ color: '#8c8c8c', width: 100 }}>回滚原因:</span>
                      <span>{auditCanaryDetail.rollback_reason}</span>
                    </List.Item>
                  )}
                  {auditCanaryDetail.percent_history && auditCanaryDetail.percent_history.length > 0 && (
                    <List.Item>
                      <span style={{ color: '#8c8c8c', width: 100, verticalAlign: 'top', paddingTop: 4 }}>
                        调整轨迹:
                      </span>
                      <div style={{ flex: 1 }}>
                        {auditCanaryDetail.percent_history.slice().reverse().map((item, idx) => (
                          <div key={idx} style={{ marginBottom: 4 }}>
                            <Tag color="blue">{item.percent}%</Tag>
                            <span style={{ marginLeft: 8, fontSize: 12, color: '#8c8c8c' }}>
                              {dayjs(item.changedAt).format('YYYY-MM-DD HH:mm:ss')}
                            </span>
                            <span style={{ marginLeft: 8, fontSize: 12 }}>{item.reason}</span>
                          </div>
                        ))}
                      </div>
                    </List.Item>
                  )}
                </List>
              ) : (
                <Empty description="暂无灰度详情" />
              )}
            </div>
          )}
        </Space>
      )}
    </Modal>
  );

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'history') {
      loadAuditLogs();
    }
  };

  return (
    <Layout style={{ background: '#fff' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #e8e8e8' }}>
        <h2 style={{ margin: 0, marginBottom: 16 }}>版本管理</h2>
        <Tabs defaultActiveKey="timeline" onChange={handleTabChange}>
          <TabPane tab="版本时间线" key="timeline">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <Input
                    placeholder="搜索 SubGraph 名称"
                    prefix={<SearchOutlined />}
                    value={searchName}
                    onChange={(e) => setSearchName(e.target.value)}
                    style={{ width: 200 }}
                    onPressEnter={loadTimeline}
                  />
                  <RangePicker
                    value={dateRange as any}
                    onChange={(dates) => setDateRange(dates as any)}
                    style={{ width: 300 }}
                  />
                  <Button type="primary" onClick={loadTimeline}>
                    筛选
                  </Button>
                  <Space>
                    <Button
                      icon={<ZoomInOutlined />}
                      onClick={() => setZoom(Math.min(zoom * 1.2, 3))}
                    />
                    <Button
                      icon={<ZoomOutOutlined />}
                      onClick={() => setZoom(Math.max(zoom / 1.2, 0.5))}
                    />
                  </Space>
                </Space>
                <Button
                  icon={<DiffOutlined />}
                  type={compareVersionIds.length === 2 ? 'primary' : 'default'}
                  onClick={handleCompareClick}
                  disabled={compareVersionIds.length !== 2}
                >
                  版本对比 ({compareVersionIds.length}/2)
                </Button>
              </div>
            </Space>
          </TabPane>
          <TabPane tab="发布记录" key="history" />
        </Tabs>
      </div>

      <Layout style={{ minHeight: 0, flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: 16, minWidth: 0, overflow: 'auto' }}>
          <Card 
            title="版本时间线" 
            style={{ display: activeTab === 'timeline' ? 'block' : 'none' }}
          >
            {renderTimeline()}
          </Card>
          <Card 
            title="发布记录" 
            style={{ display: activeTab === 'history' ? 'block' : 'none' }}
            extra={
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleExportCsv}
              >
                导出CSV
              </Button>
            }
          >
            {renderAuditTable()}
          </Card>
        </div>
        <div 
          style={{ 
            width: 450, 
            padding: 16, 
            borderLeft: '1px solid #e8e8e8', 
            overflowY: 'auto',
            display: activeTab === 'timeline' ? 'block' : 'none'
          }}
        >
          {renderVersionDetail()}
          {renderCanaryPanel()}
        </div>
      </Layout>

      {renderCompareModal()}
      {renderStartCanaryModal()}
      {renderAuditDetailModal()}
      {renderCanaryNotifications()}
    </Layout>
  );
};

export default VersionManagement;
