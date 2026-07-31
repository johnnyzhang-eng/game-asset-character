import { BrowserRouter, Route, Routes } from 'react-router'

import { createWorkflowRunStore } from '@/entities'
import { createWorkflowController } from '@/features/workflow-controller'
import { HomePage } from '@/pages/home'
import { HistoryPage } from '@/pages/history'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestDemoPage } from '@/pages/playtest/demo-page'
import { PlaytestPage, type PlaytestPageApis } from '@/pages/playtest'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage, type PrepareQuickStartProject } from '@/pages/quick-start'
import { createQuickStartService } from '@/pages/quick-start/service'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import {
  createCharacterApis,
  createGenerationApis,
  createProjectApis,
  createTaskApis,
} from './adapters'
import { AppShell } from './layout'

/**
 * 后端适配器与页面服务在模块加载时构造一次。
 *
 * WorkflowController 与其运行状态 Store 必须是稳定单例（组件渲染期间重复创建会丢状态），
 * 因此这些实例放在模块作用域，而不是在 App 组件里 new。
 */
const projectApis = createProjectApis()
const characterApis = createCharacterApis()
const generationApis = createGenerationApis()
const taskApis = createTaskApis()

const workflowStore = createWorkflowRunStore()
const workflowController = createWorkflowController({
  store: workflowStore,
  generationApis,
  taskApis,
})

/**
 * Quick Start 需要一个真实项目归属才能开始运行记录。
 * app 层负责把一句提示词整理成默认项目参数（横版 / 单向 / 256px），
 * 并通过 ProjectApis.create 返回真实 projectId，避免页面自己伪造。
 */
const prepareQuickStartProject: PrepareQuickStartProject = async (prompt) => {
  const trimmed = prompt.trim()
  return projectApis.create({
    name: trimmed.slice(0, 40) || '快速开始角色',
    perspective: 'side',
    directionalMovement: 'single',
    spriteSize: { width: 256, height: 256 },
  })
}

const quickStartService = createQuickStartService({
  controller: workflowController,
  prepareProject: prepareQuickStartProject,
})

const playtestApis: PlaytestPageApis = { characters: characterApis }

/**
 * 路由表与全局外壳。
 * app 层注入后端适配器与页面服务，使各页面接入真实后端而非「尚未配置」占位实现。
 */
export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/quick-start" element={<QuickStartPage service={quickStartService} />} />
          <Route
            path="/quick-start/:runId"
            element={<QuickStartPage service={quickStartService} />}
          />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/projects/:projectId/history" element={<HistoryPage />} />
          <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
          <Route path="/workflow-editor/:runId/:stage" element={<WorkflowEditorPage />} />
          <Route path="/playtest/demo" element={<PlaytestDemoPage />} />
          <Route path="/playtest/:characterId/:outfitId" element={<PlaytestPage apis={playtestApis} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
