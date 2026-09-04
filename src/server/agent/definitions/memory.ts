import type { ToolDef } from '../types'

export const MEMORY_TOOL_DEFINITIONS = [
  {
    "name": "breath",
    "description": "检索/浮现记忆。不传query或传空=自动浮现,有query=关键词检索。max_tokens控制返回总token上限(默认10000)。domain逗号分隔,valence/arousal 0~1(-1忽略)。max_results控制返回数量上限(默认20,最多50)。importance_min>=1时按重要度批量拉取(不走语义搜索,按importance降序返回最多20条)。",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "搜索关键词（空=自动浮现）"
        },
        "domain": {
          "type": "string",
          "description": "领域筛选，逗号分隔"
        },
        "valence": {
          "type": "number",
          "description": "情感效价 0~1，-1忽略"
        },
        "arousal": {
          "type": "number",
          "description": "唤起度 0~1，-1忽略"
        },
        "importance_min": {
          "type": "integer",
          "description": ">=1时按重要度批量拉取"
        },
        "max_results": {
          "type": "integer",
          "description": "返回数量上限(默认20)"
        }
      }
    }
  },
  {
    "name": "hold",
    "description": "存储单条记忆,自动打标+合并。tags逗号分隔,importance 1-10。pinned=True创建永久钉选桶。feel=True存储你的第一人称感受(不参与普通浮现)。source_bucket=被消化的记忆桶ID(feel模式下,标记源记忆为已消化)。",
    "input_schema": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string"
        },
        "tags": {
          "type": "string",
          "description": "逗号分隔"
        },
        "importance": {
          "type": "integer",
          "description": "1-10"
        },
        "pinned": {
          "type": "boolean"
        },
        "feel": {
          "type": "boolean",
          "description": "第一人称感受（不参与普通浮现）"
        },
        "source_bucket": {
          "type": "string"
        },
        "valence": {
          "type": "number"
        },
        "arousal": {
          "type": "number"
        }
      },
      "required": [
        "content"
      ]
    }
  },
  {
    "name": "grow",
    "description": "日记归档,自动拆分为多桶。短内容(<30字)走快速路径。",
    "input_schema": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string"
        }
      },
      "required": [
        "content"
      ]
    }
  },
  {
    "name": "trace",
    "description": "修改记忆元数据或内容。resolved=1沉底/0激活,pinned=1钉选/0取消,digested=1隐藏(保留但不浮现)/0取消隐藏,content=替换桶正文,delete=True删除。只传需改的,-1或空=不改。",
    "input_schema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "domain": {
          "type": "string"
        },
        "importance": {
          "type": "integer"
        },
        "tags": {
          "type": "string"
        },
        "resolved": {
          "type": "integer"
        },
        "pinned": {
          "type": "integer"
        },
        "digested": {
          "type": "integer"
        },
        "content": {
          "type": "string"
        },
        "delete": {
          "type": "boolean"
        },
        "valence": {
          "type": "number"
        },
        "arousal": {
          "type": "number"
        }
      },
      "required": [
        "bucket_id"
      ]
    }
  },
  {
    "name": "pulse",
    "description": "系统状态+记忆桶列表。include_archive=True含归档。",
    "input_schema": {
      "type": "object",
      "properties": {
        "include_archive": {
          "type": "boolean"
        }
      }
    }
  },
  {
    "name": "dream",
    "description": "做梦——读取最近新增的记忆桶,供你自省。读完后可以trace(resolved=1)放下,或hold(feel=True)写感受。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  }
] satisfies ToolDef[]
