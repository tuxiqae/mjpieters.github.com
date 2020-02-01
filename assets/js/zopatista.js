/* global grecaptcha */
(($, window, document) => {
  const reCaptchaSiteKey = '6LfT7JoUAAAAAOJeXkJp-_YhnKEvnz3DhEM-ni2n'
  const reCaptchaTokenMaxAge = 2 * 60 * 1000 // ms, two minutes, see https://developers.google.com/recaptcha/docs/verify

  const soPatterns = [
    // case insensitive
    new RegExp(
      '\\b(?:' +
      [
        'stackoverflow\\.com',
        'stackoverflow',
        'stack\\s+overflow',
        'on\\s+stack',
        'deleted',
        'my\\s+(?:answer|question|comment|post|response)s?',
        'reputations?',
        'upvotes',
        'reconsider\\s+your\\s+actions',
        'review\\s+(?:my\\s+)?ban',
        'who\\s+do\\s+you\\s+think\\s+you\\s+are'
      ].join('|') +
      ')\\b',
      'ig'
    ),
    // case sensitive
    new RegExp(
      '\\b(?:' +
      [
        'on\\s+SO'
      ].join('|') +
      ')\\b',
      'g'
    )
  ]
  const nonSoPatterns = [
    new RegExp(
      '\\b(?:' +
      [
        'for\\s+freelance\\s+work',
        '(?:you\\s+)?are\\s+available',
        'be\\s+available',
        '(?:your\\s+)?hourly\\s+rate',
        'interview\\s+you',
        'python\\s+training',
        'partnering\\s+with'
      ].join('|') +
      ')\\b',
      'ig'
    )
  ]
  const soScoreThreshold = 2

  const countMatches = (text, patterns) => patterns.reduce((sum, pat) => sum + (text.match(pat) || []).length, 0)

  // debounce: only call an event callback once repeated events have subsided long enough
  const debounce = (func, wait) => {
    let timeout = null
    return (...args) => {
      const next = () => func(...args)
      window.clearTimeout(timeout)
      timeout = window.setTimeout(next, wait)
    }
  }

  $(() => {
    const gtag = window.gtag || ((command, action, params) => {
      console.log('gtag()', command, action, params)
      if (command === 'event' && 'event_callback' in params) {
        params.event_callback()
      }
    })

    // Contact form handling
    if ($('.contactForm').length) {
      const form = $('.contactForm')
      const captchaResponse = form.find('#captchaResponse')
      const submitButton = form.find(':submit')
      const inputs = Array.from(form.find('input,textarea'))
      const messageArea = form.find('#contact_message')
      const soFeedback = form.find('#stackoverflow_feedback')
      const soScore = form.find('#contact_soscore')
      let soFeedbackShown = false

      const setReCaptcha = action => {
        grecaptcha.ready(() => {
          grecaptcha.execute(reCaptchaSiteKey, {
            action: action
          }).then(token => captchaResponse.val(token))
        })
      }
      setReCaptcha('contactform_load')
      // tokens are valid for a limited amount of time, so we want to refresh them periodically
      // in case someone takes longer between page load and submit. 90% of the maximum is a good
      // refresh point.
      window.setInterval(setReCaptcha, reCaptchaTokenMaxAge * 0.9, 'contactform_token_refresh')

      // check for subjects I probably will ignore; these don't block submitting but give feedback on
      // where to go instead.
      messageArea.on('input', debounce(e => {
        const msg = messageArea.val()
        const score = countMatches(msg, soPatterns) - countMatches(msg, nonSoPatterns)
        soScore.val(score)
        if (score < soScoreThreshold) {
          // given that the input event handler has been debounced at 400ms and 'fast'
          // switches states in 200ms, the .stop() calls are probably entirely redundant.
          // Still, it's probably good practice.
          if (soFeedbackShown) { soFeedback.stop(true, true).slideUp('fast') }
          soFeedbackShown = false
        } else {
          if (!soFeedbackShown) { soFeedback.stop(true, true).slideDown('fast') }
          soFeedbackShown = true
        }
      }, 400)) // The Doherty Threshold, https://lawsofux.com/doherty-threshold, via https://ux.stackexchange.com/q/95336

      form.find('input, textarea').on('input', e => {
        submitButton.prop('disabled', !inputs.every(inp => inp.validity.valid))
      })

      form.submit(e => {
        e.preventDefault()

        const href = form.attr('action')
        const email = form.find('#contact_email').val() || '<no email set>'
        const successSelector = form.data('success')
        const errorSelector = form.data('error')
        const errorText = $(form.data('error-text'))
        const magnificPopup = $.magnificPopup.instance

        gtag('event', 'submit', {
          event_category: 'contact',
          event_label: email
        })

        $.ajax({
          type: 'POST',
          dataType: 'json',
          url: href,
          data: form.serialize()
        })
          .done(response => {
            let selector
            let closeCallback = null
            let gtagEventSent = false
            let gtagAction = 'successful'

            magnificPopup.close()

            if (response.status === 'success') {
              selector = successSelector
              closeCallback = () => {
                if (!gtagEventSent) {
                  // wait another 100ms before actually closing
                  gtagEventSent = true
                  window.setTimeout(closeCallback, 100)
                }
                document.location = '/'
              }
            } else {
              gtagAction = 'error'
              selector = errorSelector
              closeCallback = () => {
                if (!gtagEventSent) {
                  // wait another 100ms before actually closing
                  gtagEventSent = true
                  window.setTimeout(closeCallback, 100)
                }
                setReCaptcha('contactform_error_retry')
              }
              errorText.text(response.message)
              gtag('event', 'exception', {
                description: `Contact form submission error: ${JSON.stringify(response)}`,
                fatal: false
              })
            }
            gtag('event', gtagAction, {
              event_category: 'contact',
              event_label: email,
              event_callback: () => { gtagEventSent = true }
            })
            magnificPopup.open({
              type: 'inline',
              items: { src: selector },
              callbacks: { close: closeCallback }
            }, 0)
          })

          .fail((xhr, status, error) => {
            var errorMessage
            var gtagEventSent = false
            var closeCallback

            if (xhr.readyState < 2) { // never got to contact a server
              errorMessage = 'Failed to contact the form server (network error)'
            } else {
              errorMessage = `(${xhr.status}) ${status} ${error}`
              if (xhr.responseText) {
                errorMessage = `<p>${errorMessage}</p><p>${xhr.responseText}</p>`
              }
            }

            magnificPopup.close()

            gtag('event', 'fail', {
              event_category: 'contact',
              event_label: email,
              event_callback: () => { gtagEventSent = true }
            })
            gtag('event', 'exception', {
              description: `Contact form submission failure: ${errorMessage}`,
              fatal: true
            })

            closeCallback = () => {
              if (!gtagEventSent) {
                // wait another 100ms before actually closing
                gtagEventSent = true
                window.setTimeout(closeCallback, 100)
              }
              setReCaptcha('contactform_error_retry')
            }

            errorText.html(errorMessage)
            magnificPopup.open({
              type: 'inline',
              items: { src: errorSelector },
              callbacks: { close: closeCallback }
            }, 0)
          })
      })
    }

    // Outgoing link tracking
    const hostname = document.location.hostname
    const external = $('a[href]').filter((_, a) => a.hostname !== hostname)

    external.click(e => {
      // Record outbound links as events, but only if it'll update this window.
      // detection based on https://github.com/googleanalytics/autotrack/blob/master/lib/plugins/outbound-link-tracker.js
      const url = $(e.target).attr('href')
      const newtab = $(e.target).attr('target') === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.which > 1
      const callback = newtab ? () => {} : () => { document.location = url }
      if (!newtab) { e.preventDefault() }
      window.setTimeout(callback, 1000)
      gtag('event', 'click', {
        event_category: 'outbound',
        event_label: url,
        transport_type: 'beacon',
        event_callback: callback
      })
    })
  })
})(window.jQuery, window, document)
