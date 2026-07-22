/** 单个引导步骤定义 */
export interface OnboardingStep {
  /** 高亮目标的 CSS 选择器（指向 LowcodeWorkspace 中的 data-onboarding 属性） */
  target: string;
  /** 步骤标题（显示在进度行） */
  title: string;
  /** 提示内容（显示在气泡主体） */
  content: string;
}

/**
 * 新手引导 5 步流程（spec §10.2）
 *
 * target 对应 LowcodeWorkspace.tsx 中各元素上的 data-onboarding 属性。
 * OnboardingTour 当前为「居中浮层」实现（不做镂空遮罩），target 用于未来
 * 扩展精确高亮时的定位依据。
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    target: '[data-onboarding="palette"]',
    title: '节点库',
    content: '从这里拖入节点到画布。试试拖一个「物品」节点到中间画布，或点击节点在画布中心创建。',
  },
  {
    target: '[data-onboarding="canvas"]',
    title: '画布与编辑',
    content: '双击节点或点 ⚙ 打开右侧抽屉编辑参数。字段旁的 ? 图标 hover 后显示 MC 领域解释。',
  },
  {
    target: '[data-onboarding="drawer"]',
    title: '参数抽屉',
    content:
      '在这里配置节点的详细参数。改完点「保存」写回画布，点「取消」丢弃草稿。校验错误会显示修复建议。',
  },
  {
    target: '[data-onboarding="canvas"]',
    title: '端口连线',
    content:
      '拖动节点端口之间的连线建立关系。例如配方的「材料」端口连到物品节点的「物品」端口，表示该物品是配方材料。',
  },
  {
    target: '[data-onboarding="compile"]',
    title: '编译生成',
    content:
      '配置完成后点「编译」生成 ModSpec，再由 mod-generator 生成 Java 文件。编译错误会在节点上高亮显示。',
  },
];
