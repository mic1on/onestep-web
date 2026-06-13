import { useState, type FormEvent } from "react";
import { api } from "./api";
import type { Credential, DebugResult, GraphNode } from "./types";

type CredentialCreateInput = {
  name: string;
  connector_type: string;
  config: Record<string, unknown>;
  env_vars: Record<string, string>;
};

type CredentialUpdateInput = CredentialCreateInput;

type CredentialKind = "mysql" | "rabbitmq" | "redis" | "sqs" | "feishu_bitable";

type EnvVarRow = {
  key: string;
  value: string;
};

type CredentialForm = {
  name: string;
  connectorType: CredentialKind;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  virtualHost: string;
  redisDb: string;
  tls: boolean;
  regionName: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  appId: string;
  appSecret: string;
  baseUrl: string;
  advancedValue: string;
  envRows: EnvVarRow[];
};

type CredentialManagerProps = {
  credentials: Credential[];
  onCreate: (input: CredentialCreateInput) => Promise<void>;
  onUpdate: (id: string, input: CredentialUpdateInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const SECRET_KEYS = new Set([
  "PASSWORD",
  "ACCESS_KEY_ID",
  "SECRET_ACCESS_KEY",
  "SESSION_TOKEN",
  "APP_ID",
  "APP_SECRET"
]);
const MASKED_SECRET = "********";

export function CredentialManager({ credentials, onCreate, onUpdate, onDelete }: CredentialManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CredentialForm>(() => defaultForm("mysql"));
  const [testBusyKey, setTestBusyKey] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DebugResult | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload = buildCredentialInput(form);
    if (editingId) {
      await onUpdate(editingId, payload);
      setEditingId(null);
      return;
    }
    await onCreate(payload);
  }

  function patch(partial: Partial<CredentialForm>) {
    setForm((current) => ({ ...current, ...partial }));
  }

  function changeType(connectorType: CredentialKind) {
    setForm(defaultForm(connectorType));
    setEditingId(null);
    setTestResult(null);
  }

  function startEdit(credential: Credential) {
    setEditingId(credential.id);
    setForm(formFromCredential(credential));
    setTestResult(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(defaultForm("mysql"));
    setTestResult(null);
  }

  function updateEnvRow(index: number, patchRow: Partial<EnvVarRow>) {
    patch({
      envRows: form.envRows.map((row, currentIndex) =>
        currentIndex === index ? { ...row, ...patchRow } : row
      )
    });
  }

  function removeEnvRow(index: number) {
    patch({ envRows: form.envRows.filter((_, currentIndex) => currentIndex !== index) });
  }

  async function runTest(key: string, node: GraphNode) {
    setTestBusyKey(key);
    setTestResult(null);
    try {
      setTestResult(await api.testConnection(node));
    } catch (error) {
      setTestResult(errorResult(error));
    } finally {
      setTestBusyKey(null);
    }
  }

  const editingCredential = credentials.find((credential) => credential.id === editingId) ?? null;

  return (
    <section className="credential-manager credential-page">
      <div className="section-heading credential-page-heading">
        <span>Credential Library</span>
        <h2>Global credentials</h2>
      </div>

      <div className="credential-workspace">
        <div className="credential-list">
          {credentials.length ? (
            credentials.map((credential) => (
              <article className="credential-row" key={credential.id}>
                <strong>{credential.name}</strong>
                <span>{credential.connector_type}</span>
                <code>{credentialSummary(credential)}</code>
                <div className="credential-actions">
                  <button
                    disabled={testBusyKey === credential.id}
                    onClick={() => runTest(credential.id, testNodeFromSavedCredential(credential))}
                    type="button"
                  >
                    {testBusyKey === credential.id ? "Testing" : "Test"}
                  </button>
                  <button onClick={() => startEdit(credential)} type="button">
                    Edit
                  </button>
                  <button className="danger-button" onClick={() => onDelete(credential.id)} type="button">
                    Delete
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="muted">No credentials yet.</p>
          )}
        </div>

        <form className="credential-form" onSubmit={submit}>
          <div className="credential-form-topline">
            <label className="field">
              <span>Name</span>
              <input onChange={(event) => patch({ name: event.target.value })} value={form.name} />
            </label>
            <label className="field">
              <span>Type</span>
              <select
                onChange={(event) => changeType(event.target.value as CredentialKind)}
                value={form.connectorType}
              >
                <option value="mysql">MySQL</option>
                <option value="rabbitmq">RabbitMQ</option>
                <option value="redis">Redis</option>
                <option value="sqs">SQS</option>
                <option value="feishu_bitable">Feishu Bitable</option>
              </select>
            </label>
          </div>

          <ConnectorFields form={form} onChange={patch} />

          <details className="credential-advanced">
            <summary>Advanced environment variables</summary>
            <div className="env-var-editor">
              <div className="env-var-heading">
                <span>Extra variables</span>
                <button
                  onClick={() => patch({ envRows: [...form.envRows, { key: "", value: "" }] })}
                  type="button"
                >
                  Add Env Var
                </button>
              </div>
              {form.envRows.map((row, index) => (
                <div className="env-var-row" key={index}>
                  <input
                    aria-label={`Env key ${index + 1}`}
                    onChange={(event) => updateEnvRow(index, { key: event.target.value })}
                    placeholder="NAME"
                    value={row.key}
                  />
                  <input
                    aria-label={`Env value ${index + 1}`}
                    onChange={(event) => updateEnvRow(index, { value: event.target.value })}
                    placeholder={editingId ? "leave masked value to keep existing" : "value"}
                    type="password"
                    value={row.value}
                  />
                  <button onClick={() => removeEnvRow(index)} type="button">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </details>

          <div className="credential-submit-row">
            <button
              disabled={testBusyKey === "form"}
              onClick={() => runTest("form", testNodeFromForm(form, editingCredential))}
              type="button"
            >
              {testBusyKey === "form" ? "Testing" : "Test Connection"}
            </button>
            <button className="primary-button" type="submit">
              {editingId ? "Update Credential" : "Add Credential"}
            </button>
            {editingId ? (
              <button onClick={resetForm} type="button">
                Cancel
              </button>
            ) : null}
          </div>
          <CredentialTestResult result={testResult} />
        </form>
      </div>
    </section>
  );
}

function ConnectorFields({
  form,
  onChange
}: {
  form: CredentialForm;
  onChange: (partial: Partial<CredentialForm>) => void;
}) {
  if (form.connectorType === "sqs") {
    return (
      <div className="connector-fields">
        <TextField label="Region" value={form.regionName} onChange={(regionName) => onChange({ regionName })} />
        <TextField label="Access Key" value={form.accessKeyId} onChange={(accessKeyId) => onChange({ accessKeyId })} />
        <TextField
          label="Secret Access Key (secret)"
          hint={secretHint(form.secretAccessKey)}
          placeholder="Enter secret access key"
          type="password"
          value={form.secretAccessKey}
          onChange={(secretAccessKey) => onChange({ secretAccessKey })}
        />
        <TextField
          label="Session Token (secret)"
          hint={secretHint(form.sessionToken)}
          placeholder="Optional session token"
          type="password"
          value={form.sessionToken}
          onChange={(sessionToken) => onChange({ sessionToken })}
        />
      </div>
    );
  }

  if (form.connectorType === "feishu_bitable") {
    return (
      <div className="connector-fields">
        <TextField label="App ID" value={form.appId} onChange={(appId) => onChange({ appId })} />
        <TextField
          label="App Secret (secret)"
          hint={secretHint(form.appSecret)}
          placeholder="Enter app secret"
          type="password"
          value={form.appSecret}
          onChange={(appSecret) => onChange({ appSecret })}
        />
        <TextField label="Base URL" value={form.baseUrl} onChange={(baseUrl) => onChange({ baseUrl })} />
      </div>
    );
  }

  return (
    <div className="connector-fields">
      <TextField label="Host" value={form.host} onChange={(host) => onChange({ host })} />
      <TextField label="Port" value={form.port} onChange={(port) => onChange({ port })} />
      {form.connectorType === "mysql" ? (
        <TextField label="Database" value={form.database} onChange={(database) => onChange({ database })} />
      ) : null}
      {form.connectorType === "rabbitmq" ? (
        <TextField label="Virtual Host" value={form.virtualHost} onChange={(virtualHost) => onChange({ virtualHost })} />
      ) : null}
      {form.connectorType === "redis" ? (
        <TextField label="Database" value={form.redisDb} onChange={(redisDb) => onChange({ redisDb })} />
      ) : null}
      <TextField label="Username" value={form.username} onChange={(username) => onChange({ username })} />
      <TextField
        label="Password (secret)"
        hint={secretHint(form.password)}
        placeholder="Enter password"
        type="password"
        value={form.password}
        onChange={(password) => onChange({ password })}
      />
      {form.connectorType === "redis" ? (
        <label className="check-field">
          <input
            checked={form.tls}
            onChange={(event) => onChange({ tls: event.target.checked })}
            type="checkbox"
          />
          <span>TLS</span>
        </label>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}

function buildCredentialInput(form: CredentialForm): CredentialCreateInput {
  const extraEnvVars = collectEnvVars(form.envRows);

  if (form.connectorType === "mysql") {
    const config = { dsn: form.advancedValue.trim() || mysqlDsn(form) };
    return withEnvSecrets(form, config, { PASSWORD: form.password }, extraEnvVars);
  }

  if (form.connectorType === "rabbitmq") {
    const config = { url: form.advancedValue.trim() || rabbitUrl(form) };
    return withEnvSecrets(form, config, { PASSWORD: form.password }, extraEnvVars);
  }

  if (form.connectorType === "redis") {
    const config = { url: form.advancedValue.trim() || redisUrl(form) };
    return withEnvSecrets(form, config, { PASSWORD: form.password }, extraEnvVars);
  }

  if (form.connectorType === "sqs") {
    const config = {
      region_name: form.regionName,
      options: {
        aws_access_key_id: "${ACCESS_KEY_ID}",
        aws_secret_access_key: "${SECRET_ACCESS_KEY}",
        ...(form.sessionToken ? { aws_session_token: "${SESSION_TOKEN}" } : {})
      }
    };
    return withEnvSecrets(
      form,
      config,
      {
        ACCESS_KEY_ID: form.accessKeyId,
        SECRET_ACCESS_KEY: form.secretAccessKey,
        SESSION_TOKEN: form.sessionToken
      },
      extraEnvVars
    );
  }

  const config = {
    app_id: "${APP_ID}",
    app_secret: "${APP_SECRET}",
    ...(form.baseUrl ? { base_url: form.baseUrl } : {})
  };
  return withEnvSecrets(
    form,
    config,
    { APP_ID: form.appId, APP_SECRET: form.appSecret },
    extraEnvVars
  );
}

function withEnvSecrets(
  form: CredentialForm,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  extraEnvVars: Record<string, string>
): CredentialCreateInput {
  return {
    name: form.name,
    connector_type: form.connectorType,
    config,
    env_vars: cleanEnvVars({ ...extraEnvVars, ...secrets })
  };
}

function mysqlDsn(form: CredentialForm, passwordMode: "secret" | "literal" = "secret"): string {
  return `${connectionScheme("mysql", form)}://${authPart(form, passwordMode)}${hostPart(form)}${pathPart(form.database)}`;
}

function rabbitUrl(form: CredentialForm, passwordMode: "secret" | "literal" = "secret"): string {
  return `${connectionScheme("amqp", form)}://${authPart(form, passwordMode)}${hostPart(form)}${pathPart(form.virtualHost || "/")}`;
}

function redisUrl(form: CredentialForm, passwordMode: "secret" | "literal" = "secret"): string {
  return `${connectionScheme("redis", form)}://${authPart(form, passwordMode)}${hostPart(form)}${pathPart(form.redisDb || "0")}`;
}

function connectionScheme(base: string, form: CredentialForm): string {
  if (form.connectorType === "redis" && form.tls) {
    return "rediss";
  }
  return base;
}

function authPart(form: CredentialForm, passwordMode: "secret" | "literal"): string {
  if (!form.username && !form.password) {
    return "";
  }
  if (!form.password) {
    return `${encodeURIComponent(form.username)}@`;
  }
  const password = passwordMode === "literal" ? encodeURIComponent(form.password) : "${PASSWORD}";
  return `${encodeURIComponent(form.username)}:${password}@`;
}

function hostPart(form: CredentialForm): string {
  const host = form.host.trim() || "localhost";
  return form.port.trim() ? `${host}:${form.port.trim()}` : host;
}

function pathPart(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `/${encodeURIComponent(trimmed)}` : "";
}

function cleanEnvVars(envVars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envVars).filter(([key, value]) => key.trim() && value !== "")
  );
}

function collectEnvVars(rows: EnvVarRow[]): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) {
      envVars[key] = row.value;
    }
  }
  return envVars;
}

function secretHint(value: string): string {
  return value === MASKED_SECRET
    ? "Stored secret; type a new value to replace it."
    : "Secret value, not an environment variable.";
}

function testNodeFromSavedCredential(credential: Credential): GraphNode {
  return {
    id: `credential_${credential.id}`,
    type: testNodeType(toCredentialKind(credential.connector_type)),
    kind: "source",
    credential_ref: credential.name,
    config: {},
    mapping: {},
    mode: null,
    input_schema: {},
    position: { x: 0, y: 0 }
  };
}

function testNodeFromForm(form: CredentialForm, credential: Credential | null): GraphNode {
  const useStoredSecrets = credential ? hasMaskedConnectorSecrets(form) : false;
  const credentialRef = useStoredSecrets && credential ? credential.name : null;
  return {
    id: "credential_form",
    type: testNodeType(form.connectorType),
    kind: "source",
    credential_ref: credentialRef,
    config: directTestConfig(form, useStoredSecrets),
    mapping: {},
    mode: null,
    input_schema: {},
    position: { x: 0, y: 0 }
  };
}

function testNodeType(connectorType: CredentialKind): string {
  return {
    mysql: "mysql_source",
    rabbitmq: "rabbitmq_source",
    redis: "redis_stream_source",
    sqs: "sqs_source",
    feishu_bitable: "feishu_bitable_source"
  }[connectorType];
}

function directTestConfig(form: CredentialForm, useStoredSecrets: boolean): Record<string, unknown> {
  if (form.connectorType === "mysql") {
    return { dsn: mysqlDsn(form, passwordTestMode(form, useStoredSecrets)) };
  }
  if (form.connectorType === "rabbitmq") {
    return { url: rabbitUrl(form, passwordTestMode(form, useStoredSecrets)) };
  }
  if (form.connectorType === "redis") {
    return { url: redisUrl(form, passwordTestMode(form, useStoredSecrets)) };
  }
  if (form.connectorType === "sqs") {
    return {
      region_name: form.regionName,
      options: cleanEnvVars({
        aws_access_key_id: testSecretValue(form.accessKeyId, "ACCESS_KEY_ID", useStoredSecrets),
        aws_secret_access_key: testSecretValue(form.secretAccessKey, "SECRET_ACCESS_KEY", useStoredSecrets),
        aws_session_token: testSecretValue(form.sessionToken, "SESSION_TOKEN", useStoredSecrets)
      })
    };
  }
  return {
    app_id: testSecretValue(form.appId, "APP_ID", useStoredSecrets),
    app_secret: testSecretValue(form.appSecret, "APP_SECRET", useStoredSecrets),
    ...(form.baseUrl ? { base_url: form.baseUrl } : {})
  };
}

function passwordTestMode(form: CredentialForm, useStoredSecrets: boolean): "secret" | "literal" {
  return useStoredSecrets && form.password === MASKED_SECRET ? "secret" : "literal";
}

function testSecretValue(value: string, key: string, useStoredSecrets: boolean): string {
  return useStoredSecrets && value === MASKED_SECRET ? `\${${key}}` : value;
}

function hasMaskedConnectorSecrets(form: CredentialForm): boolean {
  if (["mysql", "rabbitmq", "redis"].includes(form.connectorType)) {
    return form.password === MASKED_SECRET;
  }
  if (form.connectorType === "sqs") {
    return [form.accessKeyId, form.secretAccessKey, form.sessionToken].includes(MASKED_SECRET);
  }
  return [form.appId, form.appSecret].includes(MASKED_SECRET);
}

function CredentialTestResult({ result }: { result: DebugResult | null }) {
  if (!result) {
    return null;
  }
  return (
    <div className={`credential-test-result ${result.status}`}>
      <div className="debug-result-meta">
        <strong>{result.status}</strong>
        <span>{result.duration_ms} ms</span>
      </div>
      <p>{result.message}</p>
    </div>
  );
}

function errorResult(error: unknown): DebugResult {
  return {
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    data: null,
    schema: null,
    stdout: "",
    stderr: "",
    duration_ms: 0
  };
}

function defaultForm(connectorType: CredentialKind): CredentialForm {
  return {
    name: defaultName(connectorType),
    connectorType,
    host: connectorType === "mysql" ? "localhost" : "127.0.0.1",
    port: defaultPort(connectorType),
    database: "",
    username: defaultUsername(connectorType),
    password: "",
    virtualHost: "/",
    redisDb: "0",
    tls: false,
    regionName: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    appId: "",
    appSecret: "",
    baseUrl: "https://open.feishu.cn",
    advancedValue: "",
    envRows: []
  };
}

function defaultName(connectorType: CredentialKind): string {
  return {
    mysql: "PROD_MYSQL",
    rabbitmq: "PROD_RABBITMQ",
    redis: "PROD_REDIS",
    sqs: "PROD_SQS",
    feishu_bitable: "PROD_FEISHU"
  }[connectorType];
}

function defaultPort(connectorType: CredentialKind): string {
  return {
    mysql: "3306",
    rabbitmq: "5672",
    redis: "6379",
    sqs: "",
    feishu_bitable: ""
  }[connectorType];
}

function defaultUsername(connectorType: CredentialKind): string {
  return connectorType === "rabbitmq" ? "guest" : "";
}

function formFromCredential(credential: Credential): CredentialForm {
  const connectorType = toCredentialKind(credential.connector_type);
  const form = {
    ...defaultForm(connectorType),
    name: credential.name,
    envRows: envRowsFromCredential(credential)
  };
  const config = credential.config;
  const options = objectValue(config.options);
  const env = credential.env_vars;

  if (connectorType === "sqs") {
    return {
      ...form,
      regionName: stringValue(config.region_name) || "us-east-1",
      accessKeyId: secretValue(env, "ACCESS_KEY_ID", stringValue(options.aws_access_key_id)),
      secretAccessKey: secretValue(env, "SECRET_ACCESS_KEY", stringValue(options.aws_secret_access_key)),
      sessionToken: secretValue(env, "SESSION_TOKEN", stringValue(options.aws_session_token))
    };
  }

  if (connectorType === "feishu_bitable") {
    return {
      ...form,
      appId: secretValue(env, "APP_ID", stringValue(config.app_id)),
      appSecret: secretValue(env, "APP_SECRET", stringValue(config.app_secret)),
      baseUrl: stringValue(config.base_url) || "https://open.feishu.cn"
    };
  }

  const rawUrl = stringValue(config.dsn ?? config.url);
  const parsed = parseConnectionUrl(rawUrl);
  if (!parsed) {
    return { ...form, advancedValue: rawUrl };
  }
  return {
    ...form,
    host: parsed.host || form.host,
    port: parsed.port || form.port,
    username: parsed.username || form.username,
    password: secretValue(env, "PASSWORD", parsed.password),
    database: connectorType === "mysql" ? parsed.path : form.database,
    virtualHost: connectorType === "rabbitmq" ? parsed.path || "/" : form.virtualHost,
    redisDb: connectorType === "redis" ? parsed.path || "0" : form.redisDb,
    tls: rawUrl.startsWith("rediss://"),
    advancedValue: ""
  };
}

function parseConnectionUrl(rawUrl: string): { host: string; port: string; username: string; password: string; path: string } | null {
  if (!rawUrl) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname,
      port: parsed.port,
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      path: decodeURIComponent(parsed.pathname.replace(/^\//, ""))
    };
  } catch {
    return null;
  }
}

function envRowsFromCredential(credential: Credential): EnvVarRow[] {
  return Object.entries(credential.env_vars)
    .filter(([key]) => !SECRET_KEYS.has(key))
    .map(([key, value]) => ({ key, value }));
}

function secretValue(envVars: Record<string, string>, key: string, fallback: string): string {
  return key in envVars ? envVars[key] : fallback;
}

function toCredentialKind(value: string): CredentialKind {
  if (["mysql", "rabbitmq", "redis", "sqs", "feishu_bitable"].includes(value)) {
    return value as CredentialKind;
  }
  return "mysql";
}

function credentialSummary(credential: Credential): string {
  const envKeys = Object.keys(credential.env_vars);
  return envKeys.length ? envKeys.join(", ") : "typed config";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
