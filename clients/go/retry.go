package firstrun

import (
	"math/rand"
	"time"
)

// Backoff and the circuit breaker: the two things that stop a dead server from
// turning into a busy loop against a dead server.

// backoff is capped exponential with full jitter.
//
// Full jitter, not a fixed ladder, because every process in a fleet notices the
// same outage at the same moment and would otherwise retry in lockstep and
// arrive as one spike on a server that is already struggling.
func backoff(attempt int, base, max time.Duration) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	ceiling := base
	for i := 0; i < attempt && ceiling < max; i++ {
		ceiling *= 2
	}
	if ceiling > max {
		ceiling = max
	}
	if ceiling <= 0 {
		return 0
	}
	return time.Duration(rand.Int63n(int64(ceiling) + 1))
}

// breaker opens after consecutive failures and half-opens after a cooldown,
// letting exactly one request through to find out whether the server is back.
//
// Without it, a queue that keeps filling keeps generating requests to a host
// that is down, and the client becomes a load generator pointed at an incident.
//
// Only the sender goroutine touches it, so it needs no lock.
type breaker struct {
	threshold int
	reset     time.Duration
	failures  int
	openedAt  time.Time
	probing   bool
}

func (b *breaker) isOpen() bool { return b.failures >= b.threshold }

// allow reports whether a request may go out now, and marks the half-open
// probe as taken.
func (b *breaker) allow(now time.Time) bool {
	if !b.isOpen() {
		return true
	}
	if b.probing {
		return false
	}
	if now.Sub(b.openedAt) < b.reset {
		return false
	}
	b.probing = true
	return true
}

// retryAfter is how long until allow could return true again.
func (b *breaker) retryAfter(now time.Time) time.Duration {
	if !b.isOpen() {
		return 0
	}
	left := b.reset - now.Sub(b.openedAt)
	if left < 0 {
		return 0
	}
	return left
}

// onSuccess reports whether this success closed an open breaker.
func (b *breaker) onSuccess() bool {
	wasOpen := b.isOpen()
	b.failures = 0
	b.probing = false
	return wasOpen
}

// onFailure reports whether this failure is the one that opened the breaker.
func (b *breaker) onFailure(now time.Time) bool {
	wasOpen := b.isOpen()
	b.failures++
	b.probing = false
	// The cooldown restarts on every failure, including a failed probe, so a
	// server that is still down does not get a probe every reset interval.
	if b.isOpen() {
		b.openedAt = now
	}
	return !wasOpen && b.isOpen()
}
