<template>
  <div class="report-generation">
    <div class="page-header">
      <h2>报告生成</h2>
      <p>根据测评结果生成等级保护测评报告</p>
    </div>

    <div class="report-config">
      <el-card>
        <template #header>
          <span>报告配置</span>
        </template>

        <el-form label-width="120px">
          <el-form-item label="项目名称">
            <el-input v-model="reportForm.projectName" disabled />
          </el-form-item>

          <el-form-item label="报告模板">
            <el-select v-model="reportForm.template" placeholder="请选择报告模板">
              <el-option label="标准报告模板" value="standard" />
              <el-option label="详细报告模板" value="detailed" />
              <el-option label="简化报告模板" value="simple" />
            </el-select>
          </el-form-item>

          <el-form-item label="报告格式">
            <el-radio-group v-model="reportForm.format">
              <el-radio value="pdf">PDF</el-radio>
              <el-radio value="docx">Word</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="包含章节">
            <el-checkbox-group v-model="reportForm.sections">
              <el-checkbox value="executive-summary">执行摘要</el-checkbox>
              <el-checkbox value="system-overview">系统概述</el-checkbox>
              <el-checkbox value="assessment-results">测评结果</el-checkbox>
              <el-checkbox value="issues-list">问题清单</el-checkbox>
              <el-checkbox value="recommendations">整改建议</el-checkbox>
              <el-checkbox value="appendix">附录</el-checkbox>
            </el-checkbox-group>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" @click="generateReport" :loading="generating">
              生成报告
            </el-button>
            <el-button @click="previewReport">预览报告</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <div class="report-history">
      <el-card>
        <template #header>
          <span>报告历史</span>
        </template>

        <el-table :data="reportHistory" stripe>
          <el-table-column prop="name" label="报告名称" />
          <el-table-column prop="format" label="格式" width="100" />
          <el-table-column prop="generatedAt" label="生成时间" width="180" />
          <el-table-column prop="size" label="大小" width="100" />
          <el-table-column label="操作" width="200">
            <template #default="{ row }">
              <el-button type="primary" link @click="downloadReport(row)">下载</el-button>
              <el-button type="primary" link @click="viewReport(row)">查看</el-button>
              <el-button type="danger" link @click="deleteReport(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const reportForm = reactive({
  projectName: '',
  template: 'standard',
  format: 'pdf',
  sections: ['executive-summary', 'system-overview', 'assessment-results', 'issues-list', 'recommendations'],
});

const generating = ref(false);
const reportHistory = ref<any[]>([]);

async function generateReport() {
  generating.value = true;
  try {
    // 模拟报告生成
    await new Promise(resolve => setTimeout(resolve, 2000));
    ElMessage.success('报告生成成功');
  } catch {
    ElMessage.error('报告生成失败');
  } finally {
    generating.value = false;
  }
}

function previewReport() {
  ElMessage.info('预览功能开发中');
}

function downloadReport(row: any) {
  ElMessage.info(`下载报告: ${row.name}`);
}

function viewReport(row: any) {
  ElMessage.info(`查看报告: ${row.name}`);
}

async function deleteReport(_row: any) {
  try {
    await ElMessageBox.confirm('确定删除该报告吗？', '确认删除');
    ElMessage.success('删除成功');
  } catch {
    // 取消删除
  }
}
</script>

<style scoped>
.report-generation {
  padding: 20px;
}

.page-header {
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0 0 8px 0;
  font-size: 20px;
  color: #303133;
}

.page-header p {
  margin: 0;
  color: #909399;
  font-size: 14px;
}

.report-config {
  margin-bottom: 20px;
}

.report-history {
  margin-bottom: 20px;
}
</style>