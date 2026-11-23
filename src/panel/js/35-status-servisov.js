  /* ─────────── статус сервисов ─────────── */
  function applyStatusData(data) {
    State.services = data.services || data;
    State.luna = !!data.luna;
    State.glagol = !!data.glagol;
    renderStatus();
    renderServices();
  }

  function refreshStatus() {
    return refreshState();
  }

