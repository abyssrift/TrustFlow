import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Switch,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type ReportType = 'general' | 'worker_comparison' | 'team_comparison' | 'workflow_analysis';

interface ReportFilters {
  reportType: ReportType;
  timeFrame: '7' | '30' | '90' | 'custom';
  dateStart?: string;
  dateEnd?: string;
  pipelineId?: string;
  teamId?: string;
  workerId?: string;
  priorityFilter?: string;
  projectId?: string;
  // Comparison specific
  workerA_id?: string;
  workerB_id?: string;
  teamA_id?: string;
  teamB_id?: string;
}

interface ReportGeneratorProps {
  visible: boolean;
  onClose: () => void;
  onReportGenerated: () => void;
}

export default function ReportGenerator({
  visible,
  onClose,
  onReportGenerated,
}: ReportGeneratorProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'dark'];

  // State
  const [reportType, setReportType] = useState<ReportType>('general');
  const [timeFrame, setTimeFrame] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [projectId, setProjectId] = useState('');
  const [workerA_id, setWorkerA_id] = useState('');
  const [workerB_id, setWorkerB_id] = useState('');
  const [teamA_id, setTeamA_id] = useState('');
  const [teamB_id, setTeamB_id] = useState('');

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Load options
  useEffect(() => {
    if (visible) {
      loadFilterOptions();
    }
  }, [visible]);

  const loadFilterOptions = async () => {
    try {
      const [pipeRes, teamRes, workerRes, projRes] = await Promise.all([
        supabase.from('pipelines').select('id, name').limit(20),
        supabase.from('teams').select('id, name').limit(20),
        supabase.from('users').select('id, full_name').limit(20),
        supabase.from('projects').select('id, name').limit(20),
      ]);

      setPipelines(pipeRes.data || []);
      setTeams(teamRes.data || []);
      setWorkers(workerRes.data || []);
      setProjects(projRes.data || []);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  };

  const handleGenerateReport = async () => {
    try {
      setLoading(true);

      // Convert timeframe to days
      let days = 30;
      let dateStartParam = null;
      let dateEndParam = null;

      if (timeFrame === 'custom') {
        dateStartParam = dateStart ? new Date(dateStart).toISOString() : null;
        dateEndParam = dateEnd ? new Date(dateEnd).toISOString() : null;
        if (!dateStartParam || !dateEndParam) {
          Alert.alert('Error', 'Please provide both start and end dates');
          setLoading(false);
          return;
        }
      } else {
        days = parseInt(timeFrame);
      }

      // Build parameters object for the RPC
      const parameters: any = {
        days: days,
        scope: reportType === 'general' ? (pipelineId ? 'pipeline' : 'organization') : reportType,
      };

      // Add optional filters to parameters
      if (pipelineId) parameters.pipeline_id = pipelineId;
      if (teamId) parameters.team_id = teamId;
      if (workerId) parameters.worker_id = workerId;
      if (priorityFilter) parameters.priority = priorityFilter;
      if (projectId) parameters.project_id = projectId;
      
      // Add date range if custom
      if (dateStartParam) parameters.date_start = dateStartParam;
      if (dateEndParam) parameters.date_end = dateEndParam;

      // Comparison specific parameters
      if (reportType === 'worker_comparison') {
        if (!workerA_id || !workerB_id) {
          Alert.alert('Error', 'Please select both workers for comparison');
          setLoading(false);
          return;
        }
        parameters.worker_a_id = workerA_id;
        parameters.worker_b_id = workerB_id;
      }

      if (reportType === 'team_comparison') {
        if (!teamA_id || !teamB_id) {
          Alert.alert('Error', 'Please select both teams for comparison');
          setLoading(false);
          return;
        }
        parameters.team_a_id = teamA_id;
        parameters.team_b_id = teamB_id;
      }

      // Call RPC with only the 2 required parameters
      const { data: jobId, error } = await supabase.rpc('rpc_request_report', {
        p_report_type: reportType,
        p_parameters: parameters,
      });

      if (error) throw error;

      // Immediately trigger the PDF generation edge function
      if (jobId) {
        try {
          const response = await fetch(
            'https://wbvgufqfgbvbinjrdzlg.functions.supabase.co/generate-pdf-report-v8',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ job_id: jobId }),
            }
          );

          if (!response.ok) {
            console.warn('Edge function trigger warning:', response.statusText);
            // Don't fail - the job was created successfully
          }
        } catch (fetchErr) {
          console.warn('Edge function trigger error:', fetchErr);
          // Don't fail - the job was created successfully
        }
      }

      Alert.alert('Success', 'Report queued successfully!');
      onReportGenerated();
      onClose();
    } catch (error: any) {
      console.error('Report generation error:', error);
      Alert.alert('Error', error.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const renderReportTypeSelector = () => (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
        Report Type
      </Text>
      {[
        { value: 'general', label: 'General Performance Audit', desc: 'Organization or pipeline metrics' },
        { value: 'worker_comparison', label: 'Worker Comparison', desc: 'Compare 2 workers' },
        { value: 'team_comparison', label: 'Team Comparison', desc: 'Compare 2 teams' },
        { value: 'workflow_analysis', label: 'Workflow Analysis', desc: 'Pipeline deep-dive' },
      ].map((option) => (
        <TouchableOpacity
          key={option.value}
          onPress={() => setReportType(option.value as ReportType)}
          style={{
            padding: 12,
            marginBottom: 8,
            borderRadius: 8,
            borderWidth: 2,
            borderColor: reportType === option.value ? '#6366f1' : '#e2e8f0',
            backgroundColor: reportType === option.value ? '#6366f120' : 'transparent',
          }}
        >
          <Text style={{ fontWeight: '600', color: theme.text }}>{option.label}</Text>
          <Text style={{ fontSize: 12, color: theme.tabIconDefault }}>{option.desc}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderTimeFrameSelector = () => (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
        Time Frame
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
        {['7', '30', '90'].map((days) => (
          <TouchableOpacity
            key={days}
            onPress={() => setTimeFrame(days as '7' | '30' | '90')}
            style={{
              flex: 1,
              paddingVertical: 10,
              marginHorizontal: 4,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: timeFrame === days ? '#6366f1' : '#e2e8f0',
              backgroundColor: timeFrame === days ? '#6366f1' : 'transparent',
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: timeFrame === days ? 'white' : theme.text,
                fontWeight: '600',
              }}
            >
              {days}D
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={() => setTimeFrame('custom')}
          style={{
            flex: 1,
            paddingVertical: 10,
            marginHorizontal: 4,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: timeFrame === 'custom' ? '#6366f1' : '#e2e8f0',
            backgroundColor: timeFrame === 'custom' ? '#6366f1' : 'transparent',
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: timeFrame === 'custom' ? 'white' : theme.text,
              fontWeight: '600',
              fontSize: 12,
            }}
          >
            Custom
          </Text>
        </TouchableOpacity>
      </View>

      {timeFrame === 'custom' && (
        <View>
          <TextInput
            placeholder="Start Date (YYYY-MM-DD)"
            value={dateStart}
            onChangeText={setDateStart}
            style={{
              borderWidth: 1,
              borderColor: '#e2e8f0',
              borderRadius: 8,
              padding: 10,
              marginBottom: 8,
              color: theme.text,
            }}
            placeholderTextColor={theme.tabIconDefault}
          />
          <TextInput
            placeholder="End Date (YYYY-MM-DD)"
            value={dateEnd}
            onChangeText={setDateEnd}
            style={{
              borderWidth: 1,
              borderColor: '#e2e8f0',
              borderRadius: 8,
              padding: 10,
              color: theme.text,
            }}
            placeholderTextColor={theme.tabIconDefault}
          />
        </View>
      )}
    </View>
  );

  const renderGeneralFilters = () => (
    <>
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
          Pipeline (Optional)
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            onPress={() => setPipelineId('')}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginRight: 8,
              borderRadius: 20,
              backgroundColor: !pipelineId ? '#6366f1' : '#e2e8f0',
            }}
          >
            <Text style={{ color: !pipelineId ? 'white' : theme.text, fontWeight: '600' }}>
              All
            </Text>
          </TouchableOpacity>
          {pipelines.map((pipe) => (
            <TouchableOpacity
              key={pipe.id}
              onPress={() => setPipelineId(pipe.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 20,
                backgroundColor: pipelineId === pipe.id ? '#6366f1' : '#e2e8f0',
              }}
            >
              <Text
                style={{
                  color: pipelineId === pipe.id ? 'white' : theme.text,
                  fontWeight: '600',
                }}
              >
                {pipe.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
          Team (Optional)
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            onPress={() => setTeamId('')}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginRight: 8,
              borderRadius: 20,
              backgroundColor: !teamId ? '#6366f1' : '#e2e8f0',
            }}
          >
            <Text style={{ color: !teamId ? 'white' : theme.text, fontWeight: '600' }}>
              All
            </Text>
          </TouchableOpacity>
          {teams.map((team) => (
            <TouchableOpacity
              key={team.id}
              onPress={() => setTeamId(team.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 20,
                backgroundColor: teamId === team.id ? '#6366f1' : '#e2e8f0',
              }}
            >
              <Text
                style={{
                  color: teamId === team.id ? 'white' : theme.text,
                  fontWeight: '600',
                }}
              >
                {team.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
          Worker (Optional)
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            onPress={() => setWorkerId('')}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginRight: 8,
              borderRadius: 20,
              backgroundColor: !workerId ? '#6366f1' : '#e2e8f0',
            }}
          >
            <Text style={{ color: !workerId ? 'white' : theme.text, fontWeight: '600' }}>
              All
            </Text>
          </TouchableOpacity>
          {workers.map((worker) => (
            <TouchableOpacity
              key={worker.id}
              onPress={() => setWorkerId(worker.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 20,
                backgroundColor: workerId === worker.id ? '#6366f1' : '#e2e8f0',
              }}
            >
              <Text
                style={{
                  color: workerId === worker.id ? 'white' : theme.text,
                  fontWeight: '600',
                }}
              >
                {worker.full_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
          Priority (Optional)
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {['all', 'low', 'medium', 'high', 'critical'].map((priority) => (
            <TouchableOpacity
              key={priority}
              onPress={() => setPriorityFilter(priority === 'all' ? '' : priority)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 20,
                backgroundColor:
                  (priority === 'all' && !priorityFilter) || priorityFilter === priority
                    ? '#6366f1'
                    : '#e2e8f0',
              }}
            >
              <Text
                style={{
                  color:
                    (priority === 'all' && !priorityFilter) || priorityFilter === priority
                      ? 'white'
                      : theme.text,
                  fontWeight: '600',
                  textTransform: 'capitalize',
                }}
              >
                {priority}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </>
  );

  const renderWorkerComparisonFilters = () => (
    <>
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
          Worker A
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {workers.map((worker) => (
            <TouchableOpacity
              key={worker.id}
              onPress={() => setWorkerA_id(worker.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 20,
                backgroundColor: workerA_id === worker.id ? '#6366f1' : '#e2e8f0',
              }}
            >
              <Text
                style={{
                  color: workerA_id === worker.id ? 'white' : theme.text,
                  fontWeight: '600',
                }}
              >
                {worker.full_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
          Worker B
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {workers.map((worker) => (
            <TouchableOpacity
              key={worker.id}
              onPress={() => setWorkerB_id(worker.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 20,
                backgroundColor: workerB_id === worker.id ? '#6366f1' : '#e2e8f0',
              }}
            >
              <Text
                style={{
                  color: workerB_id === worker.id ? 'white' : theme.text,
                  fontWeight: '600',
                }}
              >
                {worker.full_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </>
  );

  const renderTeamComparisonFilters = () => (
    <>
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
          Team A
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {teams.map((team) => (
            <TouchableOpacity
              key={team.id}
              onPress={() => setTeamA_id(team.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 20,
                backgroundColor: teamA_id === team.id ? '#6366f1' : '#e2e8f0',
              }}
            >
              <Text
                style={{
                  color: teamA_id === team.id ? 'white' : theme.text,
                  fontWeight: '600',
                }}
              >
                {team.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: theme.text }}>
          Team B
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {teams.map((team) => (
            <TouchableOpacity
              key={team.id}
              onPress={() => setTeamB_id(team.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 20,
                backgroundColor: teamB_id === team.id ? '#6366f1' : '#e2e8f0',
              }}
            >
              <Text
                style={{
                  color: teamB_id === team.id ? 'white' : theme.text,
                  fontWeight: '600',
                }}
              >
                {team.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: '#e2e8f0',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: theme.text }}>
            Generate Report
          </Text>
          <TouchableOpacity onPress={onClose}>
            <FontAwesome name="close" size={20} color={theme.text} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView style={{ flex: 1, padding: 16 }}>
          {renderReportTypeSelector()}
          {renderTimeFrameSelector()}

          {reportType === 'general' && renderGeneralFilters()}
          {reportType === 'worker_comparison' && renderWorkerComparisonFilters()}
          {reportType === 'team_comparison' && renderTeamComparisonFilters()}
          {reportType === 'workflow_analysis' && renderGeneralFilters()}
        </ScrollView>

        {/* Footer */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 16,
            borderTopWidth: 1,
            borderTopColor: '#e2e8f0',
            flexDirection: 'row',
            gap: 12,
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            disabled={loading}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#6366f1',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#6366f1', fontWeight: '600' }}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleGenerateReport}
            disabled={loading}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: loading ? '#9ca3af' : '#6366f1',
              alignItems: 'center',
            }}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: 'white', fontWeight: '600' }}>Generate Report</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

