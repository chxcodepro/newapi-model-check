// API Proxy documentation page

"use client";

import { useState } from "react";
import { Copy, Check, ArrowLeft, ChevronDown } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  id: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}

interface EndpointProps {
  method: string;
  path: string;
  desc: string;
}

// Collapsible section component
function CollapsibleSection({
  title,
  icon,
  color,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: string;
  color?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span>{icon}</span>}
          <span className={cn("font-medium", color)}>{title}</span>
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>
      {isOpen && <div className="px-4 py-3 border-t border-border bg-background">{children}</div>}
    </div>
  );
}

function CodeBlock({ code, id, copied, onCopy }: CodeBlockProps) {
  return (
    <div className="relative group">
      <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => onCopy(code, id)}
        className="absolute top-2 right-2 p-2 rounded-md bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
        title="复制"
      >
        {copied === id ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function Endpoint({ method, path, desc }: EndpointProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "px-2 py-0.5 rounded text-xs font-medium",
            method === "GET" ? "bg-green-500/20 text-green-600" : "bg-blue-500/20 text-blue-600"
          )}
        >
          {method}
        </span>
        <code className="text-sm">{path}</code>
      </div>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </div>
  );
}

export default function ProxyDocsPage() {
  const [baseUrl] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            返回监控面板
          </Link>
          <h1 className="text-3xl font-bold mb-2">API 代理文档</h1>
          <p className="text-muted-foreground">
            将请求自动路由到对应的渠道端点，支持 OpenAI、Claude、Gemini 等多种 API 格式。
          </p>
        </div>

        {/* Base URL */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Base URL</h2>
          <CodeBlock code={baseUrl || "https://your-domain.com"} id="baseurl" copied={copied} onCopy={copyToClipboard} />
        </section>

        {/* Endpoints by Category */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">API 端点</h2>
          <div className="space-y-3">
            {/* General */}
            <CollapsibleSection title="通用" icon="📋" defaultOpen>
              <Endpoint method="GET" path="/v1/models" desc="获取所有可用模型列表" />
              <div className="mt-3">
                <p className="text-sm text-muted-foreground mb-2">
                  响应中的 <code className="bg-muted px-1 rounded">owned_by</code> 字段表示模型所属的渠道。
                </p>
                <CodeBlock
                  code={`curl ${baseUrl || "https://your-domain.com"}/v1/models \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
                  id="example-models"
                  copied={copied}
                  onCopy={copyToClipboard}
                />
              </div>
            </CollapsibleSection>

            {/* OpenAI */}
            <CollapsibleSection title="OpenAI" icon="🤖" color="text-green-600">
              <Endpoint method="POST" path="/v1/chat/completions" desc="Chat Completions API" />
              <Endpoint method="POST" path="/v1/responses" desc="Responses API (Codex)" />
              <div className="mt-3 space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">Chat Completions 示例</p>
                  <CodeBlock
                    code={`curl ${baseUrl || "https://your-domain.com"}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'`}
                    id="example-chat"
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Python SDK</p>
                  <CodeBlock
                    code={`from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl || "https://your-domain.com"}/v1",
    api_key="YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}]
)`}
                    id="config-openai"
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                </div>
              </div>
            </CollapsibleSection>

            {/* Claude */}
            <CollapsibleSection title="Claude (Anthropic)" icon="🎭" color="text-orange-600">
              <Endpoint method="POST" path="/v1/messages" desc="Messages API" />
              <div className="mt-3 space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">cURL 示例</p>
                  <CodeBlock
                    code={`curl ${baseUrl || "https://your-domain.com"}/v1/messages \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
                    id="example-claude"
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Python SDK</p>
                  <CodeBlock
                    code={`import anthropic

client = anthropic.Anthropic(
    base_url="${baseUrl || "https://your-domain.com"}",
    api_key="YOUR_API_KEY"
)

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}]
)`}
                    id="config-anthropic"
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                </div>
              </div>
            </CollapsibleSection>

            {/* Gemini */}
            <CollapsibleSection title="Gemini (Google)" icon="💎" color="text-blue-600">
              <Endpoint method="POST" path="/v1beta/models/{model}:generateContent" desc="生成内容" />
              <Endpoint method="POST" path="/v1beta/models/{model}:streamGenerateContent" desc="流式生成" />
              <div className="mt-3">
                <p className="text-sm font-medium mb-2">cURL 示例</p>
                <CodeBlock
                  code={`curl ${baseUrl || "https://your-domain.com"}/v1beta/models/gemini-2.0-flash:generateContent \\
  -H "x-goog-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{"parts": [{"text": "Hello"}]}]
  }'`}
                  id="example-gemini"
                  copied={copied}
                  onCopy={copyToClipboard}
                />
              </div>
            </CollapsibleSection>
          </div>
        </section>

        {/* Authentication */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">认证方式</h2>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm mb-3">
              根据不同的 API 格式，使用对应的认证头：
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-600 text-xs font-medium">OpenAI</span>
                <code className="bg-muted px-2 py-1 rounded">Authorization: Bearer YOUR_KEY</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-600 text-xs font-medium">Claude</span>
                <code className="bg-muted px-2 py-1 rounded">x-api-key: YOUR_KEY</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-600 text-xs font-medium">Gemini</span>
                <code className="bg-muted px-2 py-1 rounded">x-goog-api-key: YOUR_KEY</code>
              </div>
            </div>
          </div>
        </section>

        {/* Notes */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">注意事项</h2>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
            <li>模型名称必须与数据库中的模型完全匹配</li>
            <li>只有检测成功的模型才会出现在 /v1/models 列表中</li>
            <li>流式响应会透明转发，保持原始 SSE 格式</li>
            <li>代理超时时间为 10 分钟，支持长时间对话</li>
          </ul>
        </section>

        {/* Nginx Configuration */}
        <CollapsibleSection title="Nginx 配置（反向代理）" icon="⚙️">
          <p className="text-sm text-muted-foreground mb-3">
            使用 Nginx 反向代理时，需要以下配置支持流式响应：
          </p>
          <CodeBlock
            code={`location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_cache_bypass $http_upgrade;

    # 流式响应支持
    proxy_buffering off;

    # 长连接超时
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}`}
            id="nginx-config"
            copied={copied}
            onCopy={copyToClipboard}
          />
          <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-sm">
              <strong>重要：</strong>
              <code className="bg-muted px-1 rounded mx-1">proxy_buffering off</code>
              是流式响应的关键配置。
            </p>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
