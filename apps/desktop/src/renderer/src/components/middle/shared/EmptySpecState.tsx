import { EmptyState } from './EmptyState.js';

interface EmptySpecStateAction {
  label: string;
  onClick: () => void;
}

interface EmptySpecStateProps {
  /** 标题中的 spec 名称，如 "Mod" / "行为包" */
  label: string;
  /** hint 中「描述你想要的…」的用语，如 "mod" / "ZenScript 脚本" */
  describe: string;
  icon?: string;
  /** 可选行动按钮，透传给 EmptyState */
  action?: EmptySpecStateAction;
}

/** 英文开头的名称前需空格（尚未生成 Mod Spec），中文不需要（尚未生成数据包 Spec） */
const needsSpacer = (word: string) => /^[A-Za-z]/.test(word);

/** spec 未生成时的统一空状态：「尚未生成 X Spec」 */
export function EmptySpecState({ label, describe, icon = 'box', action }: EmptySpecStateProps) {
  return (
    <EmptyState
      icon={icon}
      title={`尚未生成${needsSpacer(label) ? ' ' : ''}${label} Spec`}
      hint={`在右侧 AgentPanel 描述你想要的${needsSpacer(describe) ? ' ' : ''}${describe}，生成 Spec 后即可预览`}
      action={action}
    />
  );
}
