use std::sync::Arc;

/// Postfix `Arc::new` so a built value can be chained straight into a
/// `Arc<dyn Trait>` slot: the unsized coercion applies at the `let` binding or
/// setter argument, which is also why `#[builder(into)]` cannot do this.
pub trait IntoArc: Sized {
    fn into_arc(self) -> Arc<Self> {
        Arc::new(self)
    }
}

impl<T> IntoArc for T {}

#[cfg(test)]
mod tests {
    use super::IntoArc;

    trait Greet {
        fn hi(&self) -> &'static str;
    }

    struct English;

    impl Greet for English {
        fn hi(&self) -> &'static str {
            "hi"
        }
    }

    #[test]
    fn coerces_into_trait_object() {
        let greeter: std::sync::Arc<dyn Greet> = English.into_arc();
        assert_eq!(greeter.hi(), "hi");
    }
}
