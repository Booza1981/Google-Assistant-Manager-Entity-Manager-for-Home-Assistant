const LitElementBase = Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
const html = LitElementBase.prototype.html;
const css = LitElementBase.prototype.css;

class GoogleAssistantManagerPanel extends LitElementBase {
  static get properties() {
    return {
      hass: {},
      _entities: { state: true },
      _drafts: { state: true },
      _search: { state: true },
      _domain: { state: true },
      _saving: { state: true },
      _error: { state: true },
      _snippet: { state: true },
    };
  }

  static get styles() {
    return css`
      :host {
        display: block;
        padding: 16px;
      }
      .header {
        display: grid;
        grid-template-columns: 1fr 180px auto;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
      }
      .section {
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        margin-bottom: 12px;
        padding: 12px;
      }
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .section-actions {
        display: flex;
        gap: 8px;
      }
      .row {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) 90px minmax(180px, 1fr) minmax(180px, 1fr);
        gap: 10px;
        align-items: center;
        padding: 8px 0;
        border-top: 1px solid var(--divider-color);
      }
      .row:first-of-type {
        border-top: none;
      }
      input, select {
        width: 100%;
        box-sizing: border-box;
        padding: 8px;
      }
      button {
        padding: 8px 10px;
      }
      .muted {
        color: var(--secondary-text-color);
      }
      .banner {
        background: var(--warning-color);
        color: var(--text-primary-color);
        padding: 12px;
        border-radius: 10px;
        margin-bottom: 16px;
      }
      pre {
        overflow: auto;
        white-space: pre-wrap;
        background: var(--card-background-color);
        padding: 8px;
        border-radius: 8px;
      }
      @media (max-width: 900px) {
        .header {
          grid-template-columns: 1fr;
        }
        .row {
          grid-template-columns: 1fr;
        }
      }
    `;
  }

  constructor() {
    super();
    this._entities = [];
    this._drafts = {};
    this._search = "";
    this._domain = "all";
    this._saving = false;
    this._error = null;
    this._snippet = "";
    this._loaded = false;
  }

  updated(changedProps) {
    if (!this._loaded && changedProps.has("hass") && this.hass) {
      this._loaded = true;
      this._load();
    }
  }

  async _load() {
    try {
      const [entities, snippetResp] = await Promise.all([
        this.hass.callWS({ type: "google_assistant_manager/get_entities" }),
        this.hass.callWS({ type: "google_assistant_manager/get_config_snippet" }),
      ]);
      this._entities = entities;
      this._snippet = snippetResp.snippet;
    } catch (err) {
      this._error = String(err);
    }
  }

  _toDraft(entity) {
    return {
      expose: !!entity.expose,
      aliases: Array.isArray(entity.aliases) ? [...entity.aliases] : [],
      name: entity.name || "",
    };
  }

  _getDraft(entity) {
    const draft = this._drafts[entity.entity_id];
    if (!draft) {
      return this._toDraft(entity);
    }
    const base = this._toDraft(entity);
    return {
      ...base,
      ...draft,
      aliases: Array.isArray(draft.aliases) ? draft.aliases : base.aliases,
      name: typeof draft.name === "string" ? draft.name : base.name,
    };
  }

  _setDraft(entity, next) {
    const current = this._getDraft(entity);
    this._drafts = {
      ...this._drafts,
      [entity.entity_id]: {
        ...current,
        ...next,
      },
    };
  }

  _isDirty(entity) {
    if (!(entity.entity_id in this._drafts)) return false;
    const draft = this._getDraft(entity);

    const original = this._toDraft(entity);
    const aliasesEqual = JSON.stringify(original.aliases) === JSON.stringify(draft.aliases);
    return original.expose !== draft.expose || original.name !== draft.name || !aliasesEqual;
  }

  _dirtyEntities() {
    return this._entities.filter((entity) => this._isDirty(entity));
  }

  _filterEntities() {
    const q = this._search.trim().toLowerCase();
    return this._entities.filter((entity) => {
      if (this._domain !== "all" && entity.domain !== this._domain) return false;
      if (!q) return true;
      return (
        entity.entity_id.toLowerCase().includes(q) ||
        String(entity.friendly_name || "").toLowerCase().includes(q)
      );
    });
  }

  _groupByDomain(list) {
    const grouped = {};
    list.forEach((entity) => {
      if (!grouped[entity.domain]) grouped[entity.domain] = [];
      grouped[entity.domain].push(entity);
    });
    return grouped;
  }

  _domainExposeCount(domainEntities) {
    let exposed = 0;
    domainEntities.forEach((entity) => {
      if (this._getDraft(entity).expose) exposed += 1;
    });
    return exposed;
  }

  _setDomainExpose(domainEntities, expose) {
    const nextDrafts = { ...this._drafts };
    domainEntities.forEach((entity) => {
      const draft = this._getDraft(entity);
      nextDrafts[entity.entity_id] = { ...draft, expose };
    });
    this._drafts = nextDrafts;
  }

  async _save() {
    this._saving = true;
    this._error = null;

    try {
      const dirty = this._dirtyEntities();
      for (const entity of dirty) {
        const draft = this._getDraft(entity);
        await this.hass.callWS({
          type: "google_assistant_manager/update_entity",
          entity_id: entity.entity_id,
          expose: !!draft.expose,
          aliases: Array.isArray(draft.aliases) ? draft.aliases : [],
          name: draft.name || null,
          reload: false,
        });
      }

      if (dirty.length) {
        await this.hass.callWS({ type: "google_assistant_manager/reload" });
      }

      this._drafts = {};
      await this._load();
      this.hass
        .callService("persistent_notification", "create", {
          title: "Google Assistant Manager",
          message: "Saving and reloading Google Assistant config completed.",
        })
        .catch(() => undefined);
    } catch (err) {
      this._error = String(err);
    } finally {
      this._saving = false;
    }
  }

  render() {
    const entities = this._filterEntities();
    const domains = [...new Set(this._entities.map((entity) => entity.domain))].sort();
    const grouped = this._groupByDomain(entities);
    const dirtyCount = this._dirtyEntities().length;

    return html`
      ${!this._entities.length
        ? html`<div class="banner">
            <div><strong>First-time setup:</strong> add this snippet to configuration.yaml</div>
            <pre>${this._snippet}</pre>
          </div>`
        : ""}

      <div class="header">
        <input
          placeholder="Search entities..."
          .value=${this._search}
          @input=${(ev) => {
            this._search = ev.target.value;
          }}
        />
        <select
          .value=${this._domain}
          @change=${(ev) => {
            this._domain = ev.target.value;
          }}
        >
          <option value="all">All domains</option>
          ${domains.map((domain) => html`<option value=${domain}>${domain}</option>`)}
        </select>
        <button ?disabled=${this._saving || dirtyCount === 0} @click=${this._save}>
          ${this._saving ? "Saving..." : `Save (${dirtyCount})`}
        </button>
      </div>

      ${this._error ? html`<div class="section">${this._error}</div>` : ""}
      ${dirtyCount > 0 ? html`<div class="muted">Unsaved changes: ${dirtyCount}</div>` : ""}

      ${Object.keys(grouped)
        .sort()
        .map((domain) => {
          const domainEntities = grouped[domain];
          const exposed = this._domainExposeCount(domainEntities);
          return html`
            <div class="section">
              <div class="section-header">
                <strong>${domain} (${exposed}/${domainEntities.length} exposed)</strong>
                <div class="section-actions">
                  <button @click=${() => this._setDomainExpose(domainEntities, true)}>All</button>
                  <button @click=${() => this._setDomainExpose(domainEntities, false)}>None</button>
                </div>
              </div>

              ${domainEntities.map((entity) => {
                const draft = this._getDraft(entity);
                return html`
                  <div class="row">
                    <div>
                      <div><strong>${entity.friendly_name || entity.entity_id}</strong></div>
                      <div class="muted">${entity.entity_id}</div>
                    </div>

                    <label>
                      <input
                        type="checkbox"
                        .checked=${draft.expose}
                        @change=${(ev) =>
                          this._setDraft(entity, {
                            expose: ev.target.checked,
                          })}
                      />
                      expose
                    </label>

                    <input
                      placeholder="aliases: comma,separated"
                      .value=${draft.aliases.join(", ")}
                      @input=${(ev) =>
                        this._setDraft(entity, {
                          aliases: ev.target.value
                            .split(",")
                            .map((part) => part.trim())
                            .filter((part) => part.length > 0),
                        })}
                    />

                    <input
                      placeholder="Optional Google name"
                      .value=${draft.name}
                      @input=${(ev) =>
                        this._setDraft(entity, {
                          name: ev.target.value,
                        })}
                    />
                  </div>
                `;
              })}
            </div>
          `;
        })}
    `;
  }
}

customElements.define("google-assistant-manager-panel", GoogleAssistantManagerPanel);
