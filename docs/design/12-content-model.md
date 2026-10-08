## 12. 数据模型（概要）

```ts
Instance       { id, edition, name, versionId, loader?, javaPath?, dir, createdAt }
Account        { id, type, uuid, name, encryptedToken, skinModel?, capeRef? }
ContentRef     { kind, source, projectId, versionId, hash, files[] }
ModpackRef     { source, projectId, versionId, files[], overrides[] }
Server         { id, runtime, versionId, dir, port, props, plugins[], state }
ServerConfig   { serverId, files: Record<path, content>, lastApplied }
PluginProject  { id, name, target: 'paper'|'folia'|'spigot', apiVersion, foliaSupported, files[] }
ProxyPlugin    { id, name, target: 'velocity'|'bungeecord'|'waterfall', apiVersion, files[] }
SchemaVersion  { version, appliedAt, checksum }        // 迁移幂等判断
BuildArtifact  { id, projectId, jarPath, sha256, targetMatrix[] }
TaskRecord     { id, kind, state, progress, startedAt, finishedAt, error? }
Setting        { key, value, scope }        // global / per-edition / per-instance
Conversation   { id, instanceId?, edition?, messages[], tokenUsage }
```

**约束**：所有表带 `edition` 字段或显式区域归属；所有写入走**版本化迁移脚本**。

---
