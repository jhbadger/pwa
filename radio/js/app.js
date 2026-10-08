'use strict';

const API = 'https://all.api.radio-browser.info/json';
const FAV_KEY = 'radio-favorites';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Unique key for deduplication: prefer stationuuid, fall back to resolved URL.
const stationKey = s => s.stationuuid || s.url_resolved || s.url;

class RadioApp {
  constructor() {
    this.stations    = [];   // current search results
    this.favorites   = this._loadFavorites();
    this.selectedIdx = 0;
    this.playingKey  = null; // stationKey of the playing station
    this.activeTab   = this.favorites.length ? 'favorites' : 'results';

    this.audio = document.getElementById('audio');

    this.$search    = document.getElementById('search-input');
    this.$searchBtn = document.getElementById('search-btn');
    this.$list      = document.getElementById('station-list');
    this.$npBar     = document.getElementById('now-playing-bar');
    this.$npName    = document.getElementById('now-playing-name');
    this.$npIcon    = document.getElementById('playing-icon');
    this.$stop      = document.getElementById('stop-btn');
    this.$volume    = document.getElementById('volume');
    this.$status    = document.getElementById('status');
    this.$tabFav    = document.getElementById('tab-favorites');
    this.$tabRes    = document.getElementById('tab-results');
    this.$colHdrs   = document.getElementById('col-headers');

    this.audio.volume = this.$volume.value / 100;

    this._bind();
    this._render();
    this._updateTabs();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  _loadFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); }
    catch { return []; }
  }

  _saveFavorites() {
    localStorage.setItem(FAV_KEY, JSON.stringify(this.favorites));
    this._updateTabs();
  }

  isFavorite(station) {
    const k = stationKey(station);
    return this.favorites.some(f => stationKey(f) === k);
  }

  toggleFavorite(station) {
    const k = stationKey(station);
    const idx = this.favorites.findIndex(f => stationKey(f) === k);
    if (idx === -1) {
      // Store a minimal copy so localStorage stays compact
      this.favorites.unshift({
        stationuuid: station.stationuuid,
        name:         station.name,
        url:          station.url,
        url_resolved: station.url_resolved,
        codec:        station.codec,
        bitrate:      station.bitrate,
        country:      station.country,
      });
      this._saveFavorites();
      this.setStatus(`\u2605 Saved: ${station.name}`);
    } else {
      this.favorites.splice(idx, 1);
      this._saveFavorites();
      this.setStatus(`Removed: ${station.name}`);
      // If we're on the favorites tab, re-render immediately
      if (this.activeTab === 'favorites') {
        this.selectedIdx = Math.min(this.selectedIdx, this.favorites.length - 1);
        this._render();
      }
    }
  }

  // ── Bind events ──────────────────────────────────────────────────────────

  _bind() {
    this.$searchBtn.addEventListener('click',   () => this.search());
    this.$stop.addEventListener('click',        () => this.stop());
    this.$volume.addEventListener('input', e => { this.audio.volume = e.target.value / 100; });

    this.$search.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.search(); }
    });

    this.$tabFav.addEventListener('click', () => this._switchTab('favorites'));
    this.$tabRes.addEventListener('click', () => this._switchTab('results'));

    document.addEventListener('keydown', e => this._onKey(e));

    this.audio.addEventListener('error',   () => this._onAudioError());
    this.audio.addEventListener('playing', () => this._onAudioPlaying());
    this.audio.addEventListener('waiting', () => this.setStatus('Buffering\u2026'));
    this.audio.addEventListener('stalled', () => this.setStatus('Stream stalled.'));
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  _switchTab(tab) {
    this.activeTab   = tab;
    this.selectedIdx = 0;
    this._render();
    this._updateTabs();
  }

  _updateTabs() {
    this.$tabFav.classList.toggle('active', this.activeTab === 'favorites');
    this.$tabRes.classList.toggle('active', this.activeTab === 'results');

    // Badge on Favorites tab showing count
    const n = this.favorites.length;
    const badge = n ? `<span class="tab-badge">${n}</span>` : '';
    this.$tabFav.innerHTML = `\u2605 Favorites${badge}`;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async search() {
    const q = this.$search.value.trim();
    if (!q) { this.setStatus('Enter a search term first.'); return; }

    this.setStatus('Searching\u2026');
    this.$list.innerHTML = '<div class="searching"><span class="spinner"></span>Loading\u2026</div>';
    this._switchTab('results');

    const params = new URLSearchParams({ name: q, limit: 20, hidebroken: 'true', order: 'votes' });

    try {
      const res = await fetch(`${API}/stations/search?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.stations    = data;
      this.selectedIdx = 0;
      this._render();
      if (data.length === 0) {
        this.setStatus('No stations found.');
      } else {
        this.setStatus(`${data.length} station${data.length > 1 ? 's' : ''} found. Tap to play, \u2605 to save.`);
      }
    } catch (err) {
      this.$list.innerHTML = '<div class="empty-state">Search failed. Check your connection.</div>';
      this.setStatus(`Error: ${err.message}`);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    if (this.activeTab === 'favorites') {
      this.$colHdrs.style.display = this.favorites.length ? '' : 'none';
      this._renderList(this.favorites, true);
    } else {
      this.$colHdrs.style.display = this.stations.length ? '' : 'none';
      this._renderList(this.stations, false);
    }
  }

  _renderList(list, isFavTab) {
    if (list.length === 0) {
      this.$list.innerHTML = isFavTab
        ? '<div class="fav-empty">No favorites yet.<div class="hint">Search for a station and tap \u2605 to save it here.</div></div>'
        : '<div class="empty-state">Search for a station to begin.</div>';
      return;
    }

    this.$list.innerHTML = list.map((s, i) => {
      const key  = stationKey(s);
      const isPlaying = key === this.playingKey;
      const isSaved   = this.isFavorite(s);
      const kbps = s.bitrate ? String(s.bitrate) : '';

      const cls = [
        'station-row',
        i === this.selectedIdx ? 'selected' : '',
        isPlaying ? 'playing' : '',
      ].filter(Boolean).join(' ');

      const starCls = 'star-btn' + (isSaved ? ' saved' : '');
      const starTitle = isSaved ? 'Remove from favorites' : 'Add to favorites';
      const starChar  = isSaved ? '\u2605' : '\u2606';

      return `<div class="${cls}" role="option" data-idx="${i}" aria-selected="${isPlaying}">
        <button class="${starCls}" data-idx="${i}" title="${starTitle}" aria-label="${starTitle}">${starChar}</button>
        <span class="station-name">${esc(s.name)}</span>
        <span class="station-codec">${esc(s.codec || '')}</span>
        <span class="station-bitrate">${kbps}</span>
        <span class="station-country">${esc(s.country || '')}</span>
      </div>`;
    }).join('');

    // Attach click handlers
    this.$list.querySelectorAll('.station-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.star-btn')) return; // handled separately
        const i = Number(row.dataset.idx);
        this.selectedIdx = i;
        this.playStation(list[i]);
        this._render();
      });
    });

    this.$list.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const i = Number(btn.dataset.idx);
        this.toggleFavorite(list[i]);
        // Re-render the current view so the star updates everywhere
        this._render();
      });
    });
  }

  _scrollSelected() {
    const el = this.$list.querySelector('.selected');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  playStation(station) {
    const url = station.url_resolved || station.url;
    if (!url) { this.setStatus('No stream URL for this station.'); return; }

    this.audio.pause();
    this.audio.src = url;
    this.audio.play().catch(() => this._onAudioError());

    this.playingKey = stationKey(station);
    this._updateNowPlaying(station.name);
    this.setStatus(`Loading: ${station.name}`);
  }

  stop() {
    this.audio.pause();
    this.audio.src = '';
    this.playingKey = null;
    this._render();
    this._updateNowPlaying(null);
    this.setStatus('Stopped.');
  }

  _updateNowPlaying(name) {
    if (name) {
      this.$npBar.classList.add('active');
      this.$npName.textContent = name;
      this.$npIcon.textContent = '\u266a';
    } else {
      this.$npBar.classList.remove('active');
      this.$npName.textContent = 'Not playing';
      this.$npIcon.textContent = '';
    }
  }

  _onAudioPlaying() {
    // Find station by playingKey across both lists
    const s = [...this.favorites, ...this.stations].find(x => stationKey(x) === this.playingKey);
    if (s) {
      this._updateNowPlaying(s.name);
      this.setStatus(`Playing: ${s.name}`);
    }
  }

  _onAudioError() {
    const err = this.audio.error;
    let msg = 'Playback error.';
    if (err?.code === MediaError.MEDIA_ERR_NETWORK) {
      msg = 'Network error \u2014 stream may be HTTP-only (blocked on HTTPS) or offline.';
    } else if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      msg = 'Stream format not supported by this browser.';
    }
    this.setStatus(msg);
    this.playingKey = null;
    this._updateNowPlaying(null);
    this._render();
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  _onKey(e) {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); this.stop(); return; }
    if (e.target === this.$search) return;

    const list = this.activeTab === 'favorites' ? this.favorites : this.stations;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.selectedIdx < list.length - 1) {
        this.selectedIdx++;
        this._render();
        this._scrollSelected();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.selectedIdx > 0) {
        this.selectedIdx--;
        this._render();
        this._scrollSelected();
      }
    } else if (e.key === 'Enter' && list.length > 0) {
      this.playStation(list[this.selectedIdx]);
      this._render();
    } else if (e.key === 'f' && list.length > 0) {
      this.toggleFavorite(list[this.selectedIdx]);
      this._render();
    }
  }

  setStatus(msg) { this.$status.textContent = msg; }
}

document.addEventListener('DOMContentLoaded', () => {
  new RadioApp();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
});
