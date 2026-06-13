import { useState, type FormEvent } from "react";
import type { Credential } from "./types";

type CredentialCreateInput = {
  name: string;
  connector_type: string;
  config: Record<string, unknown>;
  env_vars: Record<string, string>;
};

type CredentialUpdateInput = {
  name: string;
  connector_type: string;
  config: Record<string, unknown>;
  env_vars?: Record<string, string>;
};

type CredentialManagerProps = {
  credentials: Credential[];
  onCreate: (input: CredentialCreateInput) => Promise<void>;
  onUpdate: (id: string, input: CredentialUpdateInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function CredentialManager({ credentials, onCreate, onUpdate, onDelete }: CredentialManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("PROD_RABBITMQ");
  const [connectorType, setConnectorType] = useState("rabbitmq");
  const [url, setUrl] = useState("amqp://user:${PASSWORD}@host:5672/");
  const [password, setPassword] = useState("");
  const [regionName, setRegionName] = useState("us-east-1");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = buildCredentialInput({
      name,
      connector_type: connectorType,
      url,
      password,
      regionName,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      appId,
      appSecret
    });
    if (editingId) {
      await onUpdate(editingId, input.update);
      setEditingId(null);
      return;
    }
    await onCreate(input.create);
  }

  function startEdit(credential: Credential) {
    const config = credential.config;
    const options = objectValue(config.options);
    setEditingId(credential.id);
    setName(credential.name);
    setConnectorType(credential.connector_type);
    setUrl(stringValue(config.url ?? config.dsn) || "amqp://user:${PASSWORD}@host:5672/");
    setPassword("");
    setRegionName(stringValue(config.region_name) || "us-east-1");
    setAccessKeyId(stringValue(options.aws_access_key_id));
    setSecretAccessKey(stringValue(options.aws_secret_access_key));
    setSessionToken(stringValue(options.aws_session_token));
    setAppId(stringValue(config.app_id));
    setAppSecret(stringValue(config.app_secret));
  }

  function resetForm() {
    setEditingId(null);
    setName("PROD_RABBITMQ");
    setConnectorType("rabbitmq");
    setUrl("amqp://user:${PASSWORD}@host:5672/");
    setPassword("");
    setRegionName("us-east-1");
    setAccessKeyId("");
    setSecretAccessKey("");
    setSessionToken("");
    setAppId("");
    setAppSecret("");
  }

  return (
    <section className="credential-manager">
      <div className="section-heading">
        <span>Credential Library</span>
        <h2>Global credentials</h2>
      </div>
      <div className="credential-list">
        {credentials.map((credential) => (
          <article className="credential-row" key={credential.id}>
            <strong>{credential.name}</strong>
            <span>{credential.connector_type}</span>
            <code>{Object.keys(credential.env_vars).join(", ") || "no env vars"}</code>
            <div className="credential-actions">
              <button onClick={() => startEdit(credential)} type="button">
                Edit
              </button>
              <button className="danger-button" onClick={() => onDelete(credential.id)} type="button">
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      <form className="credential-form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="field">
          <span>Type</span>
          <select onChange={(event) => setConnectorType(event.target.value)} value={connectorType}>
            <option value="mysql">mysql</option>
            <option value="rabbitmq">rabbitmq</option>
            <option value="redis">redis</option>
            <option value="sqs">sqs</option>
            <option value="feishu_bitable">feishu_bitable</option>
          </select>
        </label>
        {connectorType === "sqs" ? (
          <>
            <label className="field">
              <span>Region</span>
              <input onChange={(event) => setRegionName(event.target.value)} value={regionName} />
            </label>
            <label className="field">
              <span>Access Key</span>
              <input onChange={(event) => setAccessKeyId(event.target.value)} value={accessKeyId} />
            </label>
            <label className="field">
              <span>Secret Key</span>
              <input
                onChange={(event) => setSecretAccessKey(event.target.value)}
                type="password"
                value={secretAccessKey}
              />
            </label>
            <label className="field">
              <span>Session Token</span>
              <input onChange={(event) => setSessionToken(event.target.value)} value={sessionToken} />
            </label>
          </>
        ) : connectorType === "feishu_bitable" ? (
          <>
            <label className="field">
              <span>App ID</span>
              <input onChange={(event) => setAppId(event.target.value)} value={appId} />
            </label>
            <label className="field">
              <span>App Secret</span>
              <input onChange={(event) => setAppSecret(event.target.value)} type="password" value={appSecret} />
            </label>
          </>
        ) : (
          <>
            <label className="field span-2">
              <span>URL / DSN</span>
              <input onChange={(event) => setUrl(event.target.value)} value={url} />
            </label>
            <label className="field">
              <span>PASSWORD</span>
              <input onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
            </label>
          </>
        )}
        <button className="primary-button" type="submit">
          {editingId ? "Update Credential" : "Add Credential"}
        </button>
        {editingId ? (
          <button onClick={resetForm} type="button">
            Cancel
          </button>
        ) : null}
      </form>
    </section>
  );
}

function buildCredentialInput(input: {
  name: string;
  connector_type: string;
  url: string;
  password: string;
  regionName: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  appId: string;
  appSecret: string;
}): { create: CredentialCreateInput; update: CredentialUpdateInput } {
  if (input.connector_type === "sqs") {
    const options: Record<string, string> = {};
    if (input.accessKeyId) {
      options.aws_access_key_id = input.accessKeyId;
    }
    if (input.secretAccessKey) {
      options.aws_secret_access_key = input.secretAccessKey;
    }
    if (input.sessionToken) {
      options.aws_session_token = input.sessionToken;
    }
    const payload = {
      name: input.name,
      connector_type: input.connector_type,
      config: {
        region_name: input.regionName,
        ...(Object.keys(options).length ? { options } : {})
      },
      env_vars: {}
    };
    return { create: payload, update: payload };
  }
  if (input.connector_type === "feishu_bitable") {
    const payload = {
      name: input.name,
      connector_type: input.connector_type,
      config: { app_id: input.appId, app_secret: input.appSecret },
      env_vars: {}
    };
    return { create: payload, update: payload };
  }
  const create: CredentialCreateInput = {
    name: input.name,
    connector_type: input.connector_type,
    config: { url: input.url },
    env_vars: input.password ? { PASSWORD: input.password } : {}
  };
  const update: CredentialUpdateInput = {
    name: input.name,
    connector_type: input.connector_type,
    config: { url: input.url }
  };
  if (input.password) {
    update.env_vars = { PASSWORD: input.password };
  }
  return { create, update };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
