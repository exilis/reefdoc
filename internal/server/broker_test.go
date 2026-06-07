package server

import "testing"

func TestBroker_BroadcastReachesSubscribers(t *testing.T) {
	b := NewBroker()
	a := b.Subscribe()
	c := b.Subscribe()
	b.Broadcast("hello")
	if got := <-a; got != "hello" {
		t.Fatalf("a got %q", got)
	}
	if got := <-c; got != "hello" {
		t.Fatalf("c got %q", got)
	}
}

func TestBroker_UnsubscribeStopsDelivery(t *testing.T) {
	b := NewBroker()
	ch := b.Subscribe()
	b.Unsubscribe(ch)
	if _, ok := <-ch; ok {
		t.Fatal("expected channel closed after unsubscribe")
	}
	b.Broadcast("x") // must not panic on a closed/removed channel
}
