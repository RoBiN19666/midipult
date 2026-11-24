  /* ─────────── привязка ─────────── */
  function bind() {
    el.btnDebug.addEventListener('click', function () {
      renderServices();
      if (typeof el.debugDlg.showModal === 'function') el.debugDlg.showModal();
      else el.debugDlg.setAttribute('open', '');
    });
    el.btnFaq.addEventListener('click', function () {
      if (typeof el.faqDlg.showModal === 'function') el.faqDlg.showModal();
      else el.faqDlg.setAttribute('open', '');
    });
    el.btnCloseFaq.addEventListener('click', function () { el.faqDlg.close(); });
    el.faqDlg.addEventListener('click', function (event) {
      if (event.target !== el.faqDlg) return;
      var rect = el.faqDlg.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) {
        el.faqDlg.close();
      }
    });
    el.btnCloseDebug.addEventListener('click', function () { el.debugDlg.close(); });
    el.btnTheme.addEventListener('click', function () {
      var light = !document.body.classList.contains('light');
      document.body.classList.toggle('light', light);
      document.documentElement.classList.toggle('light-scroll', light);
      try { localStorage.setItem('mypult-theme', light ? 'light' : 'dark'); } catch (e) {}
      el.btnTheme.textContent = light ? '☾' : '☼';
      el.btnTheme.setAttribute('aria-label', light ? 'Тёмная тема' : 'Светлая тема');
    });
    el.btnRefreshStatus.addEventListener('click', function () {
      withBusy(el.btnRefreshStatus, refreshStatus);
    });
    el.btnDiag.addEventListener('click', function () {
      withBusy(el.btnDiag, function () {
        return cgi('diag.py', {}, { timeout: 30000, silent: true }).then(function (data) {
          el.diagBox.hidden = false;
          el.diagBox.textContent = JSON.stringify(data, null, 2);
          log('diag', 'пробы выполнены', { ports: (data.ports || []).length });
        }).catch(function (err) {
          el.diagBox.hidden = false;
          el.diagBox.textContent = 'Ошибка диагностики: ' + err.message;
        });
      });
    });

    /* дисплей */
    el.btnDisplayReset.addEventListener('click', resetDisplay);
    el.btnRingReset.addEventListener('click', resetRing);
    el.btnRingAnimPlay.addEventListener('click', function () { playRingAnim(); });
    el.btnRingAnimStop.addEventListener('click', stopRingAnim);
    if (el.btnRingRestoreHidden) {
      el.btnRingRestoreHidden.addEventListener('click', restoreRingAnims);
    }
    if (el.btnRingEditor) {
      el.btnRingEditor.addEventListener('click', openRingEditor);      el.btnRingEditorClose.addEventListener('click', function () {
        if (el.ringEditorDlg) el.ringEditorDlg.close();
      });
      el.btnRingEditorAdd.addEventListener('click', function () {
        ringEditorFrames.splice(ringEditorIndex + 1, 0, ringEditorNewFrame());
        ringEditorIndex += 1;
        ringEditorPaint();
        ringEditorRenderFrames();
      });
      el.btnRingEditorDup.addEventListener('click', function () {
        ringEditorFrames.splice(ringEditorIndex + 1, 0,
          ringEditorFrames[ringEditorIndex].slice());
        ringEditorIndex += 1;
        ringEditorPaint();
        ringEditorRenderFrames();
      });
      el.btnRingEditorDelFrame.addEventListener('click', function () {
        if (ringEditorFrames.length <= 1) return;
        ringEditorFrames.splice(ringEditorIndex, 1);
        ringEditorIndex = Math.max(0, ringEditorIndex - 1);
        ringEditorPaint();
        ringEditorRenderFrames();
      });
      el.btnRingEditorFill.addEventListener('click', function () {
        ringEditorFrames[ringEditorIndex] = new Array(24).fill(ringEditorColor.replace('#', ''));
        ringEditorPaint();
      });
      el.btnRingEditorClear.addEventListener('click', function () {
        ringEditorFrames[ringEditorIndex] = ringEditorNewFrame();
        ringEditorPaint();
      });
      el.ringEditorColor.addEventListener('input', function () {
        ringEditorColor = el.ringEditorColor.value || '#00e676';
      });
      el.btnRingEditorSave.addEventListener('click', saveRingEditor);
      el.btnRingEditorPlay.addEventListener('click', function () {
        if (!ringEditorName) {
          toast('Сначала сохраните анимацию', 'warn');
          return;
        }
        playRingAnim(ringEditorName);
      });
      el.btnRingEditorDelete.addEventListener('click', function () {
        if (!ringEditorName) return;
        askConfirm('Удалить анимацию кольца «' + ringEditorName + '»?',
          { yes: 'Удалить' }).then(function (ok) {
          if (ok) ringEditorDelete(ringEditorName);
        });
      });
    }
    el.btnRingPick.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleRingPick(el.ringPickPop.hidden);
    });
    el.ringSearch.addEventListener('input', filterRingAnims);
    el.ringPickPop.addEventListener('click', function (ev) { ev.stopPropagation(); });
    // Попап вне карточки: иначе transform/animation карточки делает fixed
    // относительным её самой и список «улетает» в сторону.
    document.body.appendChild(el.ringPickPop);
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.ring-picker') && !ev.target.closest('#ringPickPop')) {
        toggleRingPick(false);
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.ringPickPop && !el.ringPickPop.hidden) {
        toggleRingPick(false);
        el.btnRingPick.focus();
      }
    });
    el.btnScreenOff.addEventListener('click', function () {
      withBusy(el.btnScreenOff, function () {
        return sendDisplayOff().then(function () {
          startDisplayOff();
          toast('Экран выключен', 'ok');
        });
      });
    });
    el.brightness.addEventListener('input', function () {
      if (State.displayAuto) disableDisplayAuto();
      applyBrightness(el.brightness.value, true);
    });
    el.ringBrightness.addEventListener('input', function () {
      if (State.ringAuto) disableRingAuto();
      setRingBrightness(el.ringBrightness.value, true);
    });
    el.ringSpeed.addEventListener('input', function () {
      setRingSpeed(el.ringSpeed.value);
    });
    el.brightChips.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip || !chip.dataset.bright) return;
      if (State.displayAuto) disableDisplayAuto();
      applyBrightness(chip.dataset.bright, true);
    });

    /* рисование на дисплее */
    el.btnDraw.addEventListener('click', function () {
      if (State.drawing) exitDrawMode();
      else enterDrawMode();
    });
    el.btnSegSend.addEventListener('click', sendDrawing);
    el.btnSegClear.addEventListener('click', clearPattern);
    el.btnSegDone.addEventListener('click', exitDrawMode);
    el.btnDisplayText.addEventListener('click', sendDisplayText);
    el.btnClockBack.addEventListener('click', returnClock);
    el.displayText.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el.btnDisplayText.click();
      }
    });
    el.displayText.addEventListener('input', function () {
      if (this.value.length > 32) this.value = this.value.slice(0, 32);
    });

    /* кольцо */
    el.colorPicker.addEventListener('input', function () {
      if (!applySelected(el.colorPicker.value)) {
        applyColor(el.colorPicker.value, 'solid');
      }
    });
    el.colorPicker.addEventListener('change', function () {
      if (!applySelected(el.colorPicker.value)) {
        applyColor(el.colorPicker.value, 'solid');
      }
    });
    el.presets.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip) return;
      if (chip.dataset.mode === 'wave' || chip.dataset.mode === 'candle') {
        startLedAnimation(chip.dataset.mode);
        return;
      }
      State.selected = null;
      ringDots.forEach(function (dot) { dot.classList.remove('sel'); });
      el.ledHint.textContent = 'Нажмите на диод, чтобы задать ему свой цвет';
      if (chip.dataset.mode) applyColor(State.color, chip.dataset.mode);
      else if (chip.dataset.hex) applyColor(chip.dataset.hex, 'solid');
    });
    el.btnLedOff.addEventListener('click', function () {
      withBusy(el.btnLedOff, function () {
        // Сначала останавливаем всё локально: JS-волну/свечу, превью
        // редактора и аппаратный проигрыватель.
        stopLedAnimation();
        State.ringPreview = null;
        State.ringAnimName = null;
        State.ringOffAt = Date.now();
        State.hwActive = false;
        State.hwLast = '';
        State.hwHoldUntil = Date.now() + 1500;
        State.ledMode = 'off';
        store.set('ledMode', 'off');
        State.selected = null;
        ringDots.forEach(function (dot) { dot.classList.remove('sel'); });
        markRingAnim(null);
        el.ledHint.textContent = 'Кольцо выключено';
        paintOff();
        markActiveChip();
        ringOffBurst();
        // И только потом гасим led_util и сам слой Luna. ring_anim_stop
        // обязателен: luna /api/led/off/ring не убивает процесс led_util,
        // поэтому анимация из редактора продолжала идти.
        return cgi('display.py', { ring_anim_stop: 1 }, { timeout: 8000, silent: true })
          .catch(function () { /* уже остановлено / нечего останавливать */ })
          .then(function () { return luna('/api/led/off/ring', {}); })
          .then(function () { toast('Кольцо погашено', 'ok'); });
      }).catch(function (err) { toast('Кольцо: ' + err.message, 'bad'); });
    });

    /* плеер */
    el.btnPrev.addEventListener('click', function () { mediaAction('prev'); });
    el.btnNext.addEventListener('click', function () { mediaAction('next'); });
    el.btnMusic.addEventListener('click', function () { mediaAction('music'); });
    el.btnLyrics.addEventListener('click', function () { openLyrics(false); });
    if (el.btnLyricsClose) el.btnLyricsClose.addEventListener('click', closeLyricsDialog);
    if (el.lyricsDlg) el.lyricsDlg.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeLyricsDialog();
    });
    if (el.btnLike) el.btnLike.addEventListener('click', toggleLike);
    if (el.btnDislike) el.btnDislike.addEventListener('click', dislikeTrack);
    if (el.lyricsInline) {
      State.lyricsInline = !!store.get('lyricsInline');
      el.lyricsInline.checked = State.lyricsInline;
      el.lyricsInline.addEventListener('change', function () {
        setLyricsInline(el.lyricsInline.checked);
      });
    }
    if (el.btnAlarmAdd) el.btnAlarmAdd.addEventListener('click', function (event) {
      event.preventDefault();
      alarmAdd();
    });
    if (el.btnAlarmOpen) el.btnAlarmOpen.addEventListener('click', function () {
      setAlarmMode(State.alarmMode || 'radio');
      setAlarmRepeat(State.alarmRepeat);
      if (el.alarmDlg) el.alarmDlg.showModal();
      buildAlarmTimeLists();
      renderAlarmTime();
      closeAlarmTime();
      loadAlarmStations();
      loadAlarmSounds();
    });
    if (el.btnAlarmTime) el.btnAlarmTime.addEventListener('click', function (event) {
      event.stopPropagation();
      if (el.alarmTimePop && el.alarmTimePop.hidden) openAlarmTime();
      else closeAlarmTime();
    });
    if (el.btnAlarmTimeDone) el.btnAlarmTimeDone.addEventListener('click', closeAlarmTime);
    if (el.alarmTimePop) el.alarmTimePop.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    if (el.btnAlarmStation) el.btnAlarmStation.addEventListener('click', function (event) {
      event.stopPropagation();
      if (el.alarmStationList) el.alarmStationList.hidden = !el.alarmStationList.hidden;
    });
    if (el.btnAlarmSound) el.btnAlarmSound.addEventListener('click', function (event) {
      event.stopPropagation();
      if (el.alarmSoundList) el.alarmSoundList.hidden = !el.alarmSoundList.hidden;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-amode]'), function (button) {
      button.addEventListener('click', function () { setAlarmMode(button.dataset.amode); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-repeat]'), function (button) {
      button.addEventListener('click', function () {
        setAlarmRepeat(button.dataset.repeat === '1');
      });
    });
    if (el.btnAlarmClose) el.btnAlarmClose.addEventListener('click', function () {
      if (el.alarmDlg) el.alarmDlg.close();
    });
    if (el.alarmDlg) {
      el.alarmDlg.addEventListener('click', function (event) {
        if (event.target === el.alarmDlg) el.alarmDlg.close();
        if (el.alarmStationList) el.alarmStationList.hidden = true;
        closeAlarmTime();
      });
      el.alarmDlg.addEventListener('close', function () {
        if (el.alarmStationList) el.alarmStationList.hidden = true;
        closeAlarmTime();
      });
    }
    if (el.btnAlarmDismiss) el.btnAlarmDismiss.addEventListener('click', alarmDismiss);
    if (el.btnAlarmSnooze) el.btnAlarmSnooze.addEventListener('click', alarmSnooze);
    if (el.alarmVolume) el.alarmVolume.addEventListener('input', function () {
      if (el.alarmVolumeVal) el.alarmVolumeVal.textContent = el.alarmVolume.value + '%';
    });
    [el.lyricsDlg, el.queueDlg].forEach(function (dialog) {
      if (!dialog) return;
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) dialog.close();
      });
    });
    if (el.btnQueue) el.btnQueue.addEventListener('click', function () { openQueue(false); });
    if (el.btnQueueClose) el.btnQueueClose.addEventListener('click', function () {
      if (el.queueDlg) el.queueDlg.close();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-qtab]'), function (button) {
      button.addEventListener('click', function () { loadQueueTab(button.dataset.qtab); });
    });
    if (el.lyricsBox) {
      el.lyricsBox.addEventListener('click', function (event) {
        var line = event.target.closest('.line');
        if (!line) return;
        var moment = parseFloat(line.dataset.t);
        var duration = State.mediaDuration || 0;
        if (isNaN(moment) || !duration) return;
        seekMedia((moment / duration) * 1000);
      });
    }
    if (el.lyricsDlg) {
      el.lyricsDlg.addEventListener('close', function () {
        if (el.lyricsBox) el.lyricsBox.style.transform = '';
        updateInlineLine();
      });
    }
    el.mediaSeek.addEventListener('input', function () {
      State.seeking = true;
      var duration = State.mediaDuration || 0;
      var position = (el.mediaSeek.value / 1000) * duration;
      el.mediaPos.textContent = fmtTime(position);
    });
    el.mediaSeek.addEventListener('change', function () {
      seekMedia(parseInt(el.mediaSeek.value, 10) || 0);
    });
    // Если перетаскивание прервалось без change, снимаем «seeking», иначе
    // ползунок перестанет обновляться.
    ['pointerup', 'pointercancel', 'blur'].forEach(function (name) {
      el.mediaSeek.addEventListener(name, function () {
        setTimeout(function () { State.seeking = false; }, 0);
      });
    });
    el.btnPlay.addEventListener('click', function () {
      mediaAction(State.playing ? 'pause' : 'play');
    });
    el.volume.addEventListener('pointerdown', function () {
      State.volumeDragging = true;
    });
    el.volume.addEventListener('pointerup', endVolumeDrag);
    el.volume.addEventListener('pointercancel', endVolumeDrag);
    el.volume.addEventListener('blur', endVolumeDrag);
    el.volume.addEventListener('input', function () {
      State.volumeDragging = true;
      setVolumeUI(parseInt(el.volume.value, 10), true);
      el.volumeVal.textContent = State.volume + '%';
      pushVolume();
      endVolumeDrag();
    });
    el.btnVolUp.addEventListener('click', function () {
      setVolumeUI(State.volume + 5);
      pushVolume();
    });
    el.btnVolDown.addEventListener('click', function () {
      setVolumeUI(State.volume - 5);
      pushVolume();
    });
    el.btnMute.addEventListener('click', function () {
      var payload = State.muted ? { unmute: 1 } : { mute: 1 };
      withBusy(el.btnMute, function () {
        return cgi('volume.py', payload, { timeout: 9000 }).then(function (data) {
          State.muted = !!(data && data.muted);
          el.btnMute.setAttribute('aria-pressed', State.muted ? 'true' : 'false');
          updateVolumeIcons();
          if (data && typeof data.level === 'number') setVolumeUI(data.level);
          toast(State.muted ? 'Звук выключен (0%)' : ('Звук включён' +
            (data && data.level ? ' · ' + data.level + '%' : '')), 'ok');
        }).catch(function (err) { toast('Mute: ' + err.message, 'bad'); });
      });
    });

    /* голос: настройки и текстовая команда */
    if (el.btnSendCmd) el.btnSendCmd.addEventListener('click', function () {
      var value = el.command.value;
      sendCommand(value).then(function () { el.command.value = ''; });
    });
    if (el.command) el.command.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (el.btnSendCmd) el.btnSendCmd.click();
      }
    });

    /* озвучка */
    el.ttsText.addEventListener('input', function () {
      el.ttsCount.textContent = el.ttsText.value.length;
    });
    el.btnSay.addEventListener('click', say);
    el.btnTtsClear.addEventListener('click', function () {
      el.ttsText.value = '';
      el.ttsCount.textContent = '0';
      el.ttsText.focus();
    });
    el.ttsChips.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip || !chip.dataset.text) return;
      el.ttsText.value = chip.dataset.text;
      el.ttsCount.textContent = el.ttsText.value.length;
      el.ttsText.focus();
    });

    /* нейросеть */
    el.llmProfiles.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (chip && chip.dataset.id) selectProfile(chip.dataset.id);
    });
    el.btnLlmNew.addEventListener('click', newProfile);
    el.llmEnabled.addEventListener('change', toggleLlmEnabled);
    el.btnChatPrev.addEventListener('click', function () { switchChat({ chat_prev: 1 }); });
    el.btnChatNext.addEventListener('click', function () { switchChat({ chat_next: 1 }); });
    el.btnChatNew.addEventListener('click', function () { switchChat({ chat_new: 1 }); });
    if (el.llmHistoryBox) {
      el.btnChatHistoryRefresh.addEventListener('click', function () {
        withBusy(el.btnChatHistoryRefresh, function () { return loadChatHistory(true); });
      });
      every(15000, pollChatHistory);
    }
    el.btnChatRename.addEventListener('click', openChatRename);
    el.btnChatRenameYes.addEventListener('click', saveChatRename);
    el.btnChatRenameNo.addEventListener('click', closeChatRename);
    el.chatRenameDlg.addEventListener('cancel', function (ev) {
      ev.preventDefault();
      closeChatRename();
    });
    el.chatRenameInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveChatRename();
      }
    });
    if (el.llmChat) el.llmChat.addEventListener('dblclick', openChatRename);
    el.btnChatDel.addEventListener('click', function () {
      var active = State.llm && State.llm.activeChat;
      if (!active) return;
      askConfirm('Удалить текущий чат вместе с историей?', { yes: 'Удалить чат' }).then(function (ok) {
        if (ok) switchChat({ chat_delete: active });
      });
    });
    el.llmLength.addEventListener('change', function () {
      var value = parseInt(el.llmLength.value, 10) || 260;
      return cgi('llm.py', { max_tokens: value }, { timeout: 10000 }).then(function (data) {
        applyLlmInfo(data);
        toast('Длина ответа: ' + el.llmLength.options[el.llmLength.selectedIndex].text, 'ok');
      }).catch(function (err) { toast('Длина ответа: ' + err.message, 'bad'); });
    });
    el.llmProviderSelect.addEventListener('change', function () {
      selectProvider(el.llmProviderSelect.value);
    });
    el.llmModel.addEventListener('change', toggleCustomModel);
    el.btnLlmSave.addEventListener('click', saveLlm);
    el.btnLlmSystem.addEventListener('click', saveLlmSystem);
    if (el.btnLlmContext) el.btnLlmContext.addEventListener('click', saveLlmContext);
    el.btnLlmAsk.addEventListener('click', function () { askLlm(false); });
    if (el.btnLlmAskSay) {
      el.btnLlmAskSay.addEventListener('click', function () { askLlm(true); });
    }
    el.llmSearch.addEventListener('change', toggleLlmSearch);
    el.llmFollowUp.addEventListener('change', toggleFollowUp);
    el.btnLlmSearchUrl.addEventListener('click', saveLlmSearchUrl);
    el.llmSearchUrl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveLlmSearchUrl();
      }
    });
    el.llmPrompt.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        if (ev.shiftKey && el.btnLlmAskSay) el.btnLlmAskSay.click();
        else el.btnLlmAsk.click();
      }
    });

    /* VPN */
    el.btnVpnSave.addEventListener('click', saveVpn);
    el.btnVpnToggle.addEventListener('click', toggleVpn);
    el.vpnUrl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el.btnVpnSave.click();
      }
    });
    el.vpnAutostart.addEventListener('change', function () {
      var on = el.vpnAutostart.checked ? 1 : 0;
      cgi('vpn.py', { autostart: on }, { timeout: 15000 }).then(function (data) {
        renderVpn(data);
        toast(on ? 'VPN будет включаться при загрузке' : 'Автозапуск VPN выключен', 'ok');
      }).catch(function (err) {
        el.vpnAutostart.checked = !el.vpnAutostart.checked;
        toast('VPN: ' + err.message, 'bad');
      });
    });

    /* голосовой демон */
    el.btnVoiceDaemon.addEventListener('click', toggleVoiceDaemon);
    if (el.voiceIdleMode) {
      el.voiceIdleMode.addEventListener('change', function () {
        setVoiceIdleMode(this.value);
      });
    }
    if (el.voiceMicMode) {
      el.voiceMicMode.addEventListener('change', function () {
        setVoiceMicMode(this.value);
      });
    }
    if (el.voiceMusicVoice) {
      el.voiceMusicVoice.addEventListener('change', function () {
        setVoiceMusicVoice(this.value === 'on');
      });
    }
    if (el.voiceMusicDefault) {
      el.voiceMusicDefault.addEventListener('change', function () {
        setVoiceMusicDefault(this.value);
      });
    }

    /* индикация панели */
    if (el.panelBright) {
      el.panelBright.addEventListener('input', function () {
        el.panelBrightVal.textContent = this.value + ' / ' + this.max;
      });
      el.panelBright.addEventListener('change', function () {
        setPanel({ brightness: parseInt(this.value, 10) || 0 });
      });
    }
    if (el.btnPanelOff) {
      el.btnPanelOff.addEventListener('click', function () { setPanel({ off: 1 }); });
    }
    if (el.btnPanelRestore) {
      el.btnPanelRestore.addEventListener('click', function () { setPanel({ restore: 1 }); });
    }

    /* радио */
    el.btnRadioPick.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleRadioPop(el.radioPop.hidden);
    });
    el.radioSearch.addEventListener('input', filterRadio);
    el.radioPop.addEventListener('click', function (ev) { ev.stopPropagation(); });
    // Попап вне карточки: иначе он попадает в scrollHeight и карточка растёт
    // при каждом открытии списка станций.
    document.body.appendChild(el.radioPop);
    window.addEventListener('resize', function () {
      if (!el.radioPop.hidden) placeRadioPop();
    });
    document.addEventListener('scroll', function () {
      if (!el.radioPop.hidden) placeRadioPop();
    }, true);
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.radio-picker') && !ev.target.closest('#radioPop')) {
        toggleRadioPop(false);
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.radioPop && !el.radioPop.hidden) {
        toggleRadioPop(false);
        el.btnRadioPick.focus();
      }
    });
    el.radioChips.addEventListener('click', function (ev) {
      var option = ev.target.closest('.radio-option');
      if (!option || option.dataset.index === undefined) return;
      toggleRadioPop(false);
      playRadio(parseInt(option.dataset.index, 10));
    });
    el.btnRadioPrev.addEventListener('click', function () { stepRadio(-1); });
    el.btnRadioNext.addEventListener('click', function () { stepRadio(1); });
    el.btnRadioStop.addEventListener('click', stopRadio);
    el.btnRadioAdd.addEventListener('click', addRadio);
    el.btnRadioStream.addEventListener('click', addRadioStream);
    el.radioName.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addRadio();
      }
    });
    el.radioUrl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addRadioStream();
      }
    });

    /* bluetooth и сеть */
    el.btnBtPower.addEventListener('click', function () {
      btAction({ action: 'power', on: (State.bt && State.bt.powered) ? 0 : 1 });
    });
    el.btnBtPairMode.addEventListener('click', function () {
      btAction({ action: 'discoverable', on: (State.bt && State.bt.discoverable) ? 0 : 1 });
    });
    el.btnBtScan.addEventListener('click', btScan);
    el.btnNetScan.addEventListener('click', netScan);
    el.btnNetDns.addEventListener('click', netDnsApply);
    el.btnNetDnsReset.addEventListener('click', netDnsReset);
    el.netIpv6.addEventListener('change', toggleIpv6);

    /* zigbee */
    el.btnZbSend.addEventListener('click', sendZb);
    el.zbCommand.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        sendZb();
      }
    });

    /* сценарии */
    el.btnScAddAction.addEventListener('click', function () { addScRow(el.scType.value); });
    el.btnScSave.addEventListener('click', saveScenario);
    el.btnScClear.addEventListener('click', clearScenarioEditor);
    el.btnDaysWork.addEventListener('click', function () { el.scDays.value = '1-5'; });
    el.btnDaysAll.addEventListener('click', function () { el.scDays.value = '1-7'; });
    el.btnDaysWeekend.addEventListener('click', function () { el.scDays.value = '6-7'; });

    /* логи */
    el.btnLogs.addEventListener('click', loadLogs);
    el.logName.addEventListener('change', loadLogs);

    if (el.btnFilesOpen) el.btnFilesOpen.addEventListener('click', filesOpen);
    if (el.btnZvukSave) el.btnZvukSave.addEventListener('click', zvukSaveToken);
    if (el.btnZvukClear) el.btnZvukClear.addEventListener('click', function () {
      cgi('zvuk.py', { action: 'clear' }, { timeout: 12000 }).then(function () {
        zvukSetStatus('Нужен токен — анонимно только 30 секунд'); zvukShowNow(null);
      }).catch(function (err) { zvukSetStatus('Ошибка: ' + err.message, 'bad'); });
    });
    if (el.btnZvukSearch) el.btnZvukSearch.addEventListener('click', zvukSearch);
    if (el.btnZvukWave) el.btnZvukWave.addEventListener('click', zvukWave);
    if (el.btnZvukSite) el.btnZvukSite.addEventListener('click', function () {
      window.open('https://zvuk.com/', '_blank', 'noopener');
    });
    if (el.btnZvukProfile) el.btnZvukProfile.addEventListener('click', function () {
      window.open('https://zvuk.com/api/tiny/profile', '_blank', 'noopener');
    });
    if (el.zvukQuery) el.zvukQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); zvukSearch(); }
    });
    if (el.btnYoutubeSearch) el.btnYoutubeSearch.addEventListener('click', youtubeSearch);
    if (el.youtubeQuery) el.youtubeQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); youtubeSearch(); }
    });
    if (el.btnSpotifySave) el.btnSpotifySave.addEventListener('click', spotifySave);
    if (el.btnSpotifyClear) el.btnSpotifyClear.addEventListener('click', function () {
      cgi('spotify.py', { action: 'clear' }, { timeout: 12000 }).then(function () {
        extStatus(el.spotifyStatus, 'Ключи удалены');
      }).catch(function (err) { extStatus(el.spotifyStatus, 'Ошибка: ' + err.message, 'bad'); });
    });
    if (el.btnSpotifySearch) el.btnSpotifySearch.addEventListener('click', spotifySearch);
    if (el.spotifyQuery) el.spotifyQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); spotifySearch(); }
    });
    if (el.btnSoundcloudSearch) el.btnSoundcloudSearch.addEventListener('click', soundcloudSearch);
    if (el.soundcloudQuery) el.soundcloudQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); soundcloudSearch(); }
    });
    if (el.btnExtSearch) el.btnExtSearch.addEventListener('click', extSearch);
    if (el.extQuery) el.extQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); extSearch(); }
    });
    zvukLoadStatus();
    extLoadStatus();
    spotifyLoadStatus();
    initProviders();
    if (el.btnFilesClose) el.btnFilesClose.addEventListener('click', function () { el.filesDlg.close(); });
    if (el.btnFilesRefresh) el.btnFilesRefresh.addEventListener('click', function () { filesLoad(filesCurrent); });
    if (el.btnFilesUp) el.btnFilesUp.addEventListener('click', function () {
      cgi('files.py', { action: 'list', path: filesCurrent }, { timeout: 15000, silent: true })
        .then(function (data) { if (data.parent) filesLoad(data.parent); })
        .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
    });
    if (el.btnFilesGo) el.btnFilesGo.addEventListener('click', function () { filesLoad(el.filesPath.value.trim()); });
    if (el.filesPath) el.filesPath.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); filesLoad(el.filesPath.value.trim()); }
    });
    if (el.btnFilesMkdir) el.btnFilesMkdir.addEventListener('click', filesMkdir);
    if (el.filesUpload) el.filesUpload.addEventListener('change', function () {
      filesUploadFile(el.filesUpload.files && el.filesUpload.files[0]);
      el.filesUpload.value = '';
    });
    if (el.btnFilesSave) el.btnFilesSave.addEventListener('click', filesSave);
    if (el.btnFilesRename) el.btnFilesRename.addEventListener('click', filesRename);
    if (el.btnFilesEditorClose) el.btnFilesEditorClose.addEventListener('click', filesCloseEditor);
    if (el.filesDlg) el.filesDlg.addEventListener('click', function (event) {
      if (event.target !== el.filesDlg) return;
      var rect = el.filesDlg.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) el.filesDlg.close();
    });

    /* обслуживание */
    el.btnNetcheck.addEventListener('click', runNetcheck);
    el.btnSpeed.addEventListener('click', runSpeed);
    el.btnCleanup.addEventListener('click', runCleanup);
    el.btnReboot.addEventListener('click', doReboot);
    el.btnCloseReboot.addEventListener('click', function () {
      if (el.rebootDlg && el.rebootDlg.open) el.rebootDlg.close();
    });
    el.btnPoweroff.addEventListener('click', doPoweroff);
    el.autoBright.addEventListener('change', toggleAutoBright);
    el.displayAuto.addEventListener('change', toggleDisplayAuto);
    if (el.btnDisplayCurve) el.btnDisplayCurve.addEventListener('click', curveOpen);
    if (el.btnCurveClose) el.btnCurveClose.addEventListener('click', curveClose);
    if (el.btnCurveAdd) el.btnCurveAdd.addEventListener('click', curveAdd);
    if (el.btnCurveReset) el.btnCurveReset.addEventListener('click', curveReset);
    if (el.btnCurveSave) el.btnCurveSave.addEventListener('click', curveSave);
    el.btnBackup.addEventListener('click', downloadBackup);
    el.btnUpdateCheck.addEventListener('click', function () { loadUpdateInfo(true, true); });
    if (el.updChannel) {
      el.updChannel.addEventListener('change', function () {
        var value = this.value;
        if (value === 'beta' && !window.confirm(
          'Бета-канал: сборки могут быть нестабильными и ломать панель. ' +
          'Вернуться на стабильную версию можно в любой момент. Включить?')) {
          this.value = 'stable';
          return;
        }
        setUpdateChannel(value);
      });
    }
    if (el.btnUpdateRollback) {
      el.btnUpdateRollback.addEventListener('click', rollbackUpdate);
    }
    if (el.btnUpdLocal) {
      el.btnUpdLocal.addEventListener('click', function () {
        var path = (el.updLocalPath.value || '').trim();
        if (!path) {
          el.updLocalPath.focus();
          toast('Укажите путь к архиву в /tmp', 'warn');
          return;
        }
        el.btnUpdLocal.disabled = true;
        el.updLocalHint.textContent = 'Запускаю установку из файла…';
        State.updateRunning = true;
        cgi('update.py', { install_local: path }, { timeout: 20000, silent: true })
          .then(function () {
            el.btnUpdLocal.disabled = false;
            pollUpdateStatus(0);
          })
          .catch(function (err) {
            State.updateRunning = false;
            el.btnUpdLocal.disabled = false;
            el.updLocalHint.textContent = 'Не удалось: ' + err.message;
            toast('Установка: ' + err.message, 'bad');
          });
      });
    }
    el.btnUpdateApply.addEventListener('click', startUpdate);
    el.btnUpdateDlgYes.addEventListener('click', startUpdate);
    el.btnUpdateLater.addEventListener('click', closeUpdateDialog);
    el.btnUpdateDlgNo.addEventListener('click', closeUpdateDialog);
    el.updateDismiss.addEventListener('change', function () {
      var info = State.updateInfo;
      if (!info || !info.latest) return;
      store.set(UPDATE_DISMISS_KEY, el.updateDismiss.checked ? info.latest : '');
      if (el.updHint) {
        el.updHint.textContent = el.updateDismiss.checked ? 'уведомление отключено' : '';
      }
    });
    el.backupFile.addEventListener('change', function () {
      if (el.backupFile.files && el.backupFile.files[0]) restoreBackup(el.backupFile.files[0]);
      el.backupFile.value = '';
    });
    el.btnSoundRefresh.addEventListener('click', loadSounds);
    el.btnSoundBackup.addEventListener('click', function () {
      window.location.href = '/cgi-bin/sounds.py?zip=1';
    });
    el.soundFile.addEventListener('change', function () {
      var file = el.soundFile.files && el.soundFile.files[0];
      var target = State.soundTarget;
      el.soundFile.value = '';
      if (file && target) uploadSound(file, target);
    });
    el.btnCustomSound.addEventListener('click', function () {
      if (!(el.customSoundName.value || '').trim()) {
        toast('Сначала введите название звука', 'warn');
        el.customSoundName.focus();
        return;
      }
      el.customSoundFile.value = '';
      el.customSoundFile.click();
    });
    el.customSoundFile.addEventListener('change', function () {
      var file = el.customSoundFile.files && el.customSoundFile.files[0];
      el.customSoundFile.value = '';
      if (file) uploadCustomSound(file);
    });
    el.soundGroup.addEventListener('change', renderSounds);
    el.soundSearch.addEventListener('input', renderSounds);
    el.soundDrop.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      el.soundDrop.classList.add('drag');
    });
    el.soundDrop.addEventListener('dragleave', function () {
      el.soundDrop.classList.remove('drag');
    });
    el.soundDrop.addEventListener('drop', function (ev) {
      ev.preventDefault();
      el.soundDrop.classList.remove('drag');
      var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) uploadCustomSound(file);
    });
    el.btnPinEnable.addEventListener('click', enablePin);
    el.btnPinDisable.addEventListener('click', disablePin);
    el.btnPinLock.addEventListener('click', lockPanel);
    el.btnPinLogin.addEventListener('click', loginPin);
    el.pinInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') loginPin();
    });

    /* разделы */
    el.tabs.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.tab');
      if (!btn || !btn.dataset.tab) return;
      // Тач: первый тап раскрывает вкладку с подписью, второй — переключает.
      if (!isTouchTabs()) return;
      if (btn.getAttribute('aria-pressed') === 'true') return;
      if (btn.classList.contains('is-peek')) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      Array.prototype.forEach.call(el.tabs.children, function (other) {
        other.classList.remove('is-peek');
      });
      btn.classList.add('is-peek');
    }, true);
    el.tabs.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.tab');
      if (btn && btn.dataset.tab) showTab(btn.dataset.tab);
    });
    window.addEventListener('hashchange', function () {
      var name = (location.hash || '').replace('#', '');
      if (name) showTab(name, false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.target && ev.target.matches && ev.target.matches('input, textarea, select')) return;
      var index = parseInt(ev.key, 10);
      if (index >= 1 && index <= TABS.length) showTab(TABS[index - 1]);
    });

    /* мобильная клавиатура не должна закрывать поле раньше времени */
    el.ttsText.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        el.btnSay.click();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshStatus();
    });
  }

