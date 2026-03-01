"""Google Assistant Manager integration."""

from __future__ import annotations

from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, PANEL_ICON, PANEL_JS_FILENAME, PANEL_TITLE, PANEL_URL
from .store import GAMStore
from .websocket_api import async_register_websocket_commands
from .yaml_writer import write_config


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up via YAML (unused, required by HA)."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Google Assistant Manager from a config entry."""
    store = GAMStore(hass)
    data = await store.async_load()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {"store": store}

    hass.http.register_static_path(
        f"/{DOMAIN}/frontend/{PANEL_JS_FILENAME}",
        hass.config.path(f"custom_components/{DOMAIN}/frontend/{PANEL_JS_FILENAME}"),
        cache_headers=False,
    )

    async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name="google-assistant-manager-panel",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"/{DOMAIN}/frontend/{PANEL_JS_FILENAME}",
        require_admin=True,
    )

    async_register_websocket_commands(hass)
    await write_config(hass, data)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload integration."""
    # `async_remove_panel` is exposed via frontend on current HA versions.
    if "frontend" in hass.data and hasattr(hass.components, "frontend"):
        hass.components.frontend.async_remove_panel(PANEL_URL)
    if DOMAIN in hass.data and entry.entry_id in hass.data[DOMAIN]:
        hass.data[DOMAIN].pop(entry.entry_id)
    return True
